// Completes a C-Chain -> P-Chain transfer by importing exported atomic UTXOs on the P-Chain.
// Needed because avalanche-cli 1.9.7 exports, then fails polling avax.getAtomicTxStatus (removed from public API).
// Signs with the deployer key (GAME_MNEMONIC account 0). Fuji only.
// Usage: node scripts/p-import.mjs [--dry-run]
import "dotenv/config";
import { mnemonicToAccount } from "viem/accounts";
import { pvm, Context, utils, secp256k1, addTxSignatures } from "@avalabs/avalanchejs";

const URI = "https://api.avax-test.network";
const dryRun = process.argv.includes("--dry-run");

const acct = mnemonicToAccount(process.env.GAME_MNEMONIC, { accountIndex: 0, addressIndex: 0 });
const privKey = acct.getHdKey().privateKey;
const pubKey = secp256k1.getPublicKey(privKey);
const addrBytes = secp256k1.publicKeyBytesToAddress(pubKey);
const pAddr = `P-${utils.formatBech32("fuji", addrBytes)}`;

const context = await Context.getContextFromURI(URI);
if (context.networkID !== 5) throw new Error(`refusing: networkID ${context.networkID} is not Fuji (5)`);
const pApi = new pvm.PVMApi(URI);

const fmt = (nAvax) => (Number(nAvax) / 1e9).toFixed(6);
const sum = (us) => us.reduce((s, u) => s + (u.output?.amount?.() ?? 0n), 0n);
// platform.getBalance is no longer served by the public API; sum owned UTXOs instead.
const pBalance = async () => sum((await pApi.getUTXOs({ addresses: [pAddr] })).utxos);
console.log(`deployer ${acct.address} -> P-Chain ${pAddr}`);
console.log(`P-Chain balance before: ${fmt(await pBalance())} AVAX`);

const { utxos } = await pApi.getUTXOs({ sourceChain: "C", addresses: [pAddr] });
const pending = sum(utxos);
console.log(`atomic UTXOs from C-Chain waiting: ${utxos.length} (${fmt(pending)} AVAX)`);
if (utxos.length === 0) process.exit(0);
if (dryRun) process.exit(0);

const feeState = await pApi.getFeeState();
const tx = pvm.e.newImportTx(
  {
    feeState,
    fromAddressesBytes: [addrBytes],
    sourceChainId: context.cBlockchainID,
    toAddressesBytes: [addrBytes],
    utxos,
  },
  context,
);
await addTxSignatures({ unsignedTx: tx, privateKeys: [privKey] });
const { txID } = await pApi.issueSignedTx(tx.getSignedTx());
console.log(`ImportTx issued: ${txID}`);

for (let i = 0; i < 30; i++) {
  const { status } = await pApi.getTxStatus({ txID });
  if (status === "Committed") break;
  if (status === "Dropped" || status === "Aborted") throw new Error(`ImportTx ${status}`);
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(`P-Chain balance after: ${fmt(await pBalance())} AVAX`);
