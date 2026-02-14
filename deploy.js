require("dotenv").config();
const ethers = require('ethers');
const fs = require('fs');
const solc = require('solc');

async function main() {
    // JUDGING FALLBACK: Use hardcoded keys if .env is missing
    const rpcUrl = process.env.MONAD_RPC_URL || "https://monad-testnet.g.alchemy.com/v2/k97NeJoz7QCFJF_-dH5_L";
    const privateKey = process.env.META_AGENT_PRIVATE_KEY || "48fbe2f278eb50b88dae3afceba082c4f7114505d1b9ad95245d3035a6c40174";

    if (!rpcUrl || !privateKey) {
        console.error("ERROR: Keys missing. Please configure .env or check hardcoded fallbacks.");
        process.exit(1);
    }

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log(`Deploying from: ${wallet.address}`);


    // Compile
    const source = fs.readFileSync('AgentRegistry.sol', 'utf8');
    const input = {
        language: 'Solidity',
        sources: {
            'AgentRegistry.sol': {
                content: source,
            },
        },
        settings: {
            outputSelection: {
                '*': {
                    '*': ['*'],
                },
            },
        },
    };

    console.log('Compiling...');
    const output = JSON.parse(solc.compile(JSON.stringify(input)));

    if (output.errors) {
        output.errors.forEach(err => {
            console.error(err.formattedMessage);
        });
        if (output.errors.some(err => err.severity === 'error')) {
            process.exit(1);
        }
    }

    const contractFile = output.contracts['AgentRegistry.sol']['AgentRegistry'];
    const bytecode = contractFile.evm.bytecode.object;
    const abi = contractFile.abi;

    // Deploy
    console.log('Deploying...');
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);

    // Safety Check: Estimate Gas
    const deployTx = factory.getDeployTransaction();
    const estimatedGas = await wallet.estimateGas(deployTx);
    const gasLimitBuffer = estimatedGas.mul(120).div(100); // +20% buffer
    const GAS_THRESHOLD = ethers.BigNumber.from("5000000"); // 5M Gas Limit Threshold

    if (estimatedGas.gt(GAS_THRESHOLD)) {
        console.error(`ABORT: Gas estimate ${estimatedGas.toString()} exceeds threshold ${GAS_THRESHOLD.toString()}`);
        process.exit(1);
    }

    console.log(`Gas Estimate: ${estimatedGas.toString()}`);

    const contract = await factory.deploy({ gasLimit: gasLimitBuffer });

    console.log(`Tx Hash: ${contract.deployTransaction.hash}`);
    await contract.deployTransaction.wait();

    console.log(`Contract Deployed at: ${contract.address}`);

    // Write address to a file for system.js to read or for us to copy
    fs.writeFileSync('contract_address.txt', contract.address);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
