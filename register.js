require("dotenv").config();
const { ethers } = require("ethers");

async function run() {
  const provider = new ethers.providers.JsonRpcProvider(
    process.env.MONAD_RPC
  );

  const wallet = new ethers.Wallet(
    process.env.META_AGENT_PRIVATE_KEY,
    provider
  );

  const contractAddress = "0x04A7baE9686B51109ce4EC23dFfa93Bd43bE8026";

  const abi = [
    "function registerAgent(bytes32 agentId)"
  ];

  const contract = new ethers.Contract(contractAddress, abi, wallet);

  const agentId = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("DINESH_META_AGENT")
  );

  const tx = await contract.registerAgent(agentId);
  await tx.wait();

  console.log("🔥 Agent Registered!");
}

run();
