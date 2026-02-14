/**
 * AUTONOMOUS SYSTEM OBSERVER - LIVE CLIENT
 * 
 * Connects to Ethereum Mainnet via public RPC.
 * Reacts deterministically to new blocks.
 * NO SIMULATION. NO FAKE DATA.
 */

const CONFIG = {
    // MONAD RPC Endpoint (Alchemy)
    rpcUrl: window.MONAD_RPC_URL,
    pollInterval: 1000, // Monad block time is ~1s
    maxRetries: 1
};

if (!CONFIG.rpcUrl || CONFIG.rpcUrl.includes("REPLACE_WITH")) {
    console.error("MONAD_RPC_URL not configured in index.html");
    // We do not throw here to allow the UI to perhaps show a degraded state, 
    // but the critical check in MetaAgent will catch it or the loop will fail.
    // Actually, following instructions to "log a clear error".
}

const UI = {
    log: document.getElementById('event-log'),

    renderEvent(data) {
        const el = document.createElement('div');
        el.className = `event type-${data.type} state-${data.state || 'active'}`;
        if (data.cid) el.dataset.cid = data.cid;

        let content = `<span class="data">${data.message}</span>`;
        if (data.hash) content += `<span class="meta hash">${data.hash}</span>`;
        if (data.latency) content += `<span class="meta latency">+${data.latency}ms</span>`;

        el.innerHTML = `
            <div class="timestamp">${new Date().toISOString()}</div>
            <div class="type">${data.type}</div>
            <div class="content">${content}</div>
        `;

        this.log.appendChild(el);
        window.scrollTo(0, document.body.scrollHeight);
    },

    setErrorState(isError) {
        if (isError) document.body.classList.add('mode-degraded');
        else document.body.classList.remove('mode-degraded');
    }
};

/**
 * AUTONOMOUS SYSTEM OBSERVER
 */

// --- WORKER SOURCES (ISOLATED PROCESSES) ---

const WORKER_HUNTER_SOURCE = `
self.onmessage = function(e) {
    const { type, payload } = e.data;
    if (type === 'INIT') {
        self.id = payload.id;
        self.lastGas = 0;
        self.evalWindow = 0;
        self.outputs = 0;
        self.maxSilence = 10;
        self.consecutiveFailures = 0;
    } else if (type === 'BLOCK') {
        processBlock(payload);
    }
};

function processBlock(block) {
    self.evalWindow++;
    const gasUsed = parseInt(block.gasUsed, 16);
    const cid = block.hash.substr(2, 8);

    // FAILURE ACKNOWLEDGEMENT (From previous block execution)
    // The main thread tells us if we failed the previous transaction
    if (block.executionFailed) {
        self.consecutiveFailures++;
    }

    // Logic
    if (self.lastGas === 0) {
        self.lastGas = gasUsed;
        return;
    }

    const delta = Math.abs(gasUsed - self.lastGas);
    self.lastGas = gasUsed;

    // Decision Logic
    if (delta > 3000000) {
         self.outputs++;
         self.evalWindow = 0; // Reset silence window
         self.postMessage({
             type: 'DECISION',
             decision: {
                 type: 'decision',
                 message: \`[\${self.id}] OPPORTUNITY: gas_delta_\${Math.floor(delta/1000)}k -> capture\`,
                 cid: cid,
                 action: 'EXECUTE'
             }
         });
    }

    // Self-Evaluation Metrics Report
    // required for the Meta-Agent to judge us
    self.postMessage({
        type: 'METRICS',
        metrics: {
            evalWindow: self.evalWindow,
            outputs: self.outputs,
            consecutiveFailures: self.consecutiveFailures,
            efficiency: (self.outputs / (self.evalWindow || 1)),
            maxSilence: self.maxSilence
        }
    });
}
`;

const WORKER_CRISIS_SOURCE = `
self.onmessage = function(e) {
    const { type, payload } = e.data;
    if (type === 'INIT') {
        self.id = payload.id;
        self.evalWindow = 0;
        self.maxLife = 20;
    } else if (type === 'BLOCK') {
        self.evalWindow++;
        
        // Crisis Agent: Minimalist Failure Monitor
        // Only acts if it observes an explicit failure signal
        if (payload.executionFailed) { 
             const cid = payload.hash.substr(2, 8);
             
             self.postMessage({
                 type: 'DECISION',
                 decision: {
                     type: 'decision',
                     message: \`[\${self.id}] DEFENSE: detected_revert -> tightening_slippage\`,
                     cid: cid,
                     action: 'EXECUTE'
                 }
            });
        }

        self.postMessage({
            type: 'METRICS',
            metrics: {
                evalWindow: self.evalWindow,
                maxLife: self.maxLife
            }
        });
    }
};
`;

// --- META-AGENT (ORCHESTRATOR) ---

class MetaAgent {
    constructor() {
        this.lastBlock = 0;
        this.lastGas = 0;
        this.agents = new Map(); // id -> { worker, metrics, type }
        this.isCycling = false;

        // Signal Tracking Counters
        this.highGasCount = 0;
        this.globalFailures = 0;

        // Finality Tracking
        this.tombstones = new Set();

        // ON-CHAIN IDENTITY (MONAD)
        // ON-CHAIN IDENTITY (MONAD)
        // CHECK: The private key must be provided via window configuration.
        const pk = window.META_AGENT_PRIVATE_KEY;

        if (pk && !pk.includes("REPLACE_WITH")) {
            this.identity = new ethers.Wallet(pk);
        } else {
            console.error("META_AGENT_PRIVATE_KEY not configured in index.html");
            throw new Error("CRITICAL: window.META_AGENT_PRIVATE_KEY is missing or default. Please configure index.html");
        }

        // Use Global Config for consistency
        this.monadRpc = CONFIG.rpcUrl;

        // READ THE DEPLOYED CONTRACT ADDRESS (User must update this after deployment)
        this.registryAddr = '0x04A7baE9686B51109ce4EC23dFfa93Bd43bE8026';

        this.provider = new ethers.providers.JsonRpcProvider(this.monadRpc);
        this.signer = this.identity.connect(this.provider);

        // Minimal Registry ABI (Events Only)
        this.abi = [
            "function registerAgent(bytes32 agentId) external",
            "function deregisterAgent(bytes32 agentId) external",
            "event AgentRegistered(address indexed meta, bytes32 indexed agentId, uint256 blockNumber)",
            "event AgentDeregistered(address indexed meta, bytes32 indexed agentId, uint256 blockNumber)"
        ];
        this.contract = new ethers.Contract(this.registryAddr, this.abi, this.signer);

        this.pendingTypes = new Map(); // id -> type

        // EVENT SUBSCRIPTIONS
        if (this.contract) {
            this.contract.on("AgentRegistered", (meta, agentIdBytes, blockNum) => {
                const id = ethers.utils.parseBytes32String(agentIdBytes);
                this.handleAgentRegistered(id, blockNum);
            });

            this.contract.on("AgentDeregistered", (meta, agentIdBytes, blockNum) => {
                const id = ethers.utils.parseBytes32String(agentIdBytes);
                this.handleAgentDeregistered(id, blockNum);
            });
        }

        UI.renderEvent({
            type: 'system',
            message: `META_ID_INIT: ${this.identity.address.substr(0, 10)}... // network:monad`
        });
    }

    async broadcastLifecycle(id, action, detail) {
        // STRICT: Real RPC attempt only. No simulation.

        // Check if we have a valid contract
        if (!this.contract || this.contract.address === ethers.constants.AddressZero) {
            UI.renderEvent({ type: 'lifecycle', message: `CHAIN_SYNC: paused_contract_not_configured`, state: 'degraded' });
            return;
        }

        UI.renderEvent({
            type: 'lifecycle',
            message: `CHAIN_SYNC: initiating_tx [${action}] -> ${this.contract.address.substr(0, 8)}...`
        });

        try {
            // Verify Network Connection First
            try {
                await this.provider.getNetwork();
            } catch (netErr) {
                // If we can't talk to the network, we PAUSE.
                UI.renderEvent({ type: 'lifecycle', message: `CHAIN_SYNC: paused_rpc_unreachable // network:monad`, state: 'degraded' });
                return;
            }

            // Convert string ID to bytes32
            const agentIdBytes = ethers.utils.formatBytes32String(id.substr(0, 31));

            // Gas Safety Threshold
            const GAS_THRESHOLD = ethers.BigNumber.from("500000");

            let tx;
            if (action === 'SPAWN') {
                // Estimate Gas first
                const est = await this.contract.estimateGas.registerAgent(agentIdBytes);
                if (est.gt(GAS_THRESHOLD)) throw new Error(`Gas estimate ${est.toString()} exceeds safety threshold`);

                tx = await this.contract.registerAgent(agentIdBytes);
            } else if (action === 'KILL') {
                const est = await this.contract.estimateGas.deregisterAgent(agentIdBytes);
                if (est.gt(GAS_THRESHOLD)) throw new Error(`Gas estimate ${est.toString()} exceeds safety threshold`);

                tx = await this.contract.deregisterAgent(agentIdBytes);
            }

            if (tx && tx.hash) {
                UI.renderEvent({ type: 'lifecycle', message: `CHAIN_SYNC: tx_broadcast // hash:${tx.hash}` });

                // AWAIT CONFIRMATION
                const receipt = await tx.wait();
                UI.renderEvent({
                    type: 'lifecycle',
                    message: `CHAIN_SYNC: tx_confirmed // block:${receipt.blockNumber} // gas:${receipt.gasUsed.toString()}`,
                    state: 'success'
                });
            }

        } catch (e) {
            // STRICT ERROR CLASSIFICATION
            let reason = 'unknown_error';

            if (e.code === 'INSUFFICIENT_FUNDS') {
                reason = 'insufficient_funds';
            } else if (e.code === 'NETWORK_ERROR' || e.code === 'SERVER_ERROR') {
                UI.renderEvent({ type: 'lifecycle', message: `CHAIN_SYNC: paused_rpc_instability`, state: 'degraded' });
                return;
            } else if (e.code === 'CALL_EXCEPTION') {
                reason = 'contract_revert';
            } else if (e.message.includes('safety threshold')) {
                reason = 'gas_safety_abort';
            } else {
                reason = e.code || e.message;
            }

            // We log the honest failure. We do NOT fake a success.
            UI.renderEvent({ type: 'lifecycle', message: `CHAIN_SYNC: tx_aborted // reason:${reason}`, state: 'degraded' });
        }
    }

    async requestSpawn(id, type) {
        if (this.agents.has(id)) return;
        if (this.pendingTypes.has(id)) return; // Already requested
        if (this.tombstones.has(id)) return;

        this.pendingTypes.set(id, type);
        // Only Broadcast. Do not spawn worker yet.
        await this.broadcastLifecycle(id, 'SPAWN', type);
    }

    async requestKill(id, reason) {
        if (!this.agents.has(id)) return;
        // Only Broadcast. Do not kill worker yet.
        await this.broadcastLifecycle(id, 'KILL', reason);
    }

    handleAgentRegistered(id, blockNum) {
        // CONFIRMED ON CHAIN
        if (this.agents.has(id)) return;

        const type = this.pendingTypes.get(id) || 'HUNTER'; // Default or retrieve

        let source;
        if (type === 'HUNTER') source = WORKER_HUNTER_SOURCE;
        else if (type === 'CRISIS') source = WORKER_CRISIS_SOURCE;
        else return;

        // CREATE REAL WORKER THREAD
        const blob = new Blob([source], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));

        // Initialize Worker State
        worker.postMessage({ type: 'INIT', payload: { id, startBlock: blockNum.toString() } });

        // Setup Listener
        worker.onmessage = (e) => this.handleWorkerMessage(id, e.data);

        this.agents.set(id, {
            worker,
            type,
            metrics: { evalWindow: 0, outputs: 0, efficiency: 0, consecutiveFailures: 0 },
            pendingExec: null
        });

        this.pendingTypes.delete(id);

        // tombstone removal if re-spawn allowed? 
        // For now, adhere to Strict Finality: Tombstones are permanent in this session logic,
        // unless we decide on-chain resurrection is allowed.
        // If the chain says "Registered", we must obey.
        if (this.tombstones.has(id)) this.tombstones.delete(id);

        UI.renderEvent({ type: 'lifecycle', message: `META: agent_spawned_confirmed [${id}] // type:${type} // block:${blockNum}`, state: 'success' });
    }

    handleAgentDeregistered(id, blockNum) {
        // CONFIRMED ON CHAIN
        const agent = this.agents.get(id);
        if (agent) {
            agent.worker.terminate();
            this.agents.delete(id);
            this.tombstones.add(id);

            UI.renderEvent({ type: 'lifecycle', message: `META: agent_terminated_confirmed [${id}] // block:${blockNum}`, state: 'degraded' });
        }
    }

    handleWorkerMessage(id, data) {
        const agent = this.agents.get(id);
        if (!agent) return;

        if (data.type === 'DECISION') {
            const decision = data.decision;
            UI.renderEvent(decision);

            if (decision.action === 'EXECUTE') {
                agent.pendingExec = decision;
                // We don't execute immediately here; we let the main loop handle the "Execution" phase 
                // to maintain the block synchronization, but we mark it as pending.
            }
        } else if (data.type === 'METRICS') {
            agent.metrics = { ...agent.metrics, ...data.metrics };
        }
    }

    async start() {
        UI.renderEvent({ type: 'system', message: 'META_AGENT: initializing_control_loop...' });
        this.loop();
    }

    async loop() {
        if (this.isCycling) return;
        this.isCycling = true;
        try {
            await this.checkChain();
            UI.setErrorState(false);
        } catch (e) {
            if (!document.body.classList.contains('mode-degraded')) {
                UI.renderEvent({ type: 'system', state: 'degraded', message: 'CONNECTION_LOST: retrying...' });
            }
            UI.setErrorState(true);
        }
        this.isCycling = false;
        setTimeout(() => this.loop(), CONFIG.pollInterval);
    }

    async rpcCall(method, params = []) {
        try {
            const response = await fetch(CONFIG.rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params })
            });
            if (!response.ok) return null; // Fail silently on non-200
            const text = await response.text();
            try {
                const data = JSON.parse(text);
                if (data.error) return null; // Fail silently on RPC error
                return data;
            } catch (e) { return null; } // Fail silently on invalid JSON
        } catch (e) { throw e; } // Network errors bubble up to be handled by loop() (minimal retry log)
    }

    async checkChain() {
        const heightRes = await this.rpcCall('eth_blockNumber');
        if (!heightRes || !heightRes.result) return;
        const currentHeight = parseInt(heightRes.result, 16);

        if (currentHeight <= this.lastBlock && this.lastBlock !== 0) return;

        if (this.lastBlock === 0) {
            this.lastBlock = currentHeight;
            UI.renderEvent({ type: 'system', message: `SYNCED: head_at_block_${currentHeight}` });
            return;
        }

        this.lastBlock = currentHeight;
        this.processBlock(currentHeight);
    }

    async processBlock(number) {
        const startTime = Date.now();
        const hexNum = '0x' + number.toString(16);
        const blockRes = await this.rpcCall('eth_getBlockByNumber', [hexNum, false]);

        if (!blockRes || !blockRes.result) return;

        const block = blockRes.result;
        const cid = block.hash.substr(2, 8);
        const gasUsed = parseInt(block.gasUsed, 16);

        // 1️⃣ META OBSERVATION
        UI.renderEvent({
            type: 'observation',
            message: `BLOCK: ${number} // agents_active:${this.agents.size} // gas:${gasUsed}`,
            cid: cid,
            state: 'success'
        });

        // 2️⃣ CINEMATIC SIGNAL DETECTION
        const GAS_THRESHOLD = 4000000; // 4M cinematic mode
        const SPAWN_COOLDOWN = 5;

        if (!this.lastSpawnBlock) this.lastSpawnBlock = 0;

        if (gasUsed > GAS_THRESHOLD && number > this.lastSpawnBlock + SPAWN_COOLDOWN) {
            this.lastSpawnBlock = number;

            UI.renderEvent({
                type: 'signal',
                message: `SIGNAL: gas_spike_${Math.floor(gasUsed / 1000000)}M`,
                state: 'success'
            });

            const id = `hunter_${number}`;
            this.requestSpawn(id, 'HUNTER');
        }

        // Optional periodic Crisis agent (adds swarm feel)
        if (number % 9 === 0) {
            const id = `crisis_${number}`;
            this.requestSpawn(id, 'CRISIS');
        }

        // 3️⃣ EXECUTION PHASE
        for (const [id, agent] of this.agents) {
            if (agent.pendingExec) {
                UI.renderEvent({
                    type: 'execution',
                    message: `[${id}] DECISION_LOG: ${block.hash.substr(0, 12)}...`,
                    hash: block.hash,
                    cid: agent.pendingExec.cid,
                    state: 'success',
                    latency: Date.now() - startTime
                });

                agent.pendingExec = null;
            }

            agent.worker.postMessage({
                type: 'BLOCK',
                payload: {
                    gasUsed: block.gasUsed,
                    hash: block.hash,
                    executionFailed: false
                }
            });
        }

        // 4️⃣ EVALUATION PHASE
        await new Promise(r => setTimeout(r, 200));

        for (const [id, agent] of this.agents) {
            const m = agent.metrics;
            let reason = null;

            if (agent.type === 'HUNTER') {
                if (m.evalWindow > 15)
                    reason = 'natural_lifecycle_expired';

                if (m.evalWindow > 10 && m.efficiency < 0.1)
                    reason = `low_efficiency_${m.efficiency.toFixed(2)}`;
            }

            if (agent.type === 'CRISIS') {
                if (m.evalWindow >= 20)
                    reason = 'crisis_lifecycle_complete';
            }

            if (m.consecutiveFailures > 0)
                reason = 'execution_fault';

            if (reason) {
                UI.renderEvent({
                    type: 'evaluation',
                    message: `EVALUATION: terminating_${id} // reason:${reason}`,
                    state: 'degraded'
                });

                this.requestKill(id, reason);
            }
        }
    }


}

// Interaction Handlers (Hover)
document.addEventListener('mouseover', (e) => {
    const eventEl = e.target.closest('.event');
    if (eventEl && eventEl.dataset.cid) {
        document.body.classList.add('has-hover');
        const cid = eventEl.dataset.cid;
        document.querySelectorAll(`.event[data-cid="${cid}"]`).forEach(el => {
            el.classList.add('active-cid');
        });
    }
});
document.addEventListener('mouseout', () => {
    document.body.classList.remove('has-hover');
    document.querySelectorAll('.active-cid').forEach(el => el.classList.remove('active-cid'));
});

// Boot
const meta = new MetaAgent();
meta.start();
