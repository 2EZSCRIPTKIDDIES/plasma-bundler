const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');
const fs = require('fs');
const path = require('path');

// Suppress warnings in both main and worker threads
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
    return;
  }
  console.warn(warning);
});

function generateKeypair(desiredPrefix, desiredSuffix) {
  const keypair = Keypair.generate();
  const publicKey = bs58.encode(keypair.publicKey.toBytes());
  
  if ((desiredPrefix && publicKey.startsWith(desiredPrefix)) || 
      (desiredSuffix && publicKey.endsWith(desiredSuffix)) ||
      (desiredPrefix && desiredSuffix && publicKey.startsWith(desiredPrefix) && publicKey.endsWith(desiredSuffix))) {
    const privateKey = bs58.encode(keypair.secretKey);
    return { 
      publicKey, 
      privateKey,
      secretKeyArray: Array.from(keypair.secretKey)
    };
  }
  
  return null;
}

function generateSolanaVanityKeypair(options = {}) {
  const {
    prefix = '',
    suffix = '',
    timeoutSeconds = 300,
    cores = Math.max(1, os.cpus().length - 2)
  } = options;

  return new Promise((resolve, reject) => {
    if (isMainThread) {
      console.log(`[Main] Starting generation with prefix '${prefix}' and suffix '${suffix}' using ${cores} cores...`);
      const workers = new Set();
      let totalAttempts = 0;
      let resultFound = false;
      const startTime = Date.now();
      let lastUpdateTime = startTime;

      const updateProgress = () => {
        const currentTime = Date.now();
        const elapsedSeconds = (currentTime - startTime) / 1000;
        const overallAttemptsPerSecond = totalAttempts / elapsedSeconds;

        process.stdout.write(`\r[${new Date().toISOString()}] Total: ${totalAttempts.toLocaleString()} | Overall: ${overallAttemptsPerSecond.toFixed(2)}/s`);

        lastUpdateTime = currentTime;
      };

      const progressInterval = setInterval(updateProgress, 1000);

      const timeout = setTimeout(() => {
        console.log('\n[Main] Generation timed out. Terminating workers...');
        clearInterval(progressInterval);
        for (const worker of workers) {
          worker.terminate();
        }
        reject(new Error(`Keypair generation timed out after ${timeoutSeconds} seconds`));
      }, timeoutSeconds * 1000);

      for (let i = 0; i < cores; i++) {
        const worker = new Worker(__filename, { workerData: { prefix, suffix } });
        workers.add(worker);

        worker.on('message', (message) => {
          if (message.type === 'result' && !resultFound) {
            resultFound = true;
            clearInterval(progressInterval);
            clearTimeout(timeout);
            console.log('\n[Main] Result found. Terminating workers...');
            for (const w of workers) {
              w.terminate();
            }
            resolve(message.data);
          } else if (message.type === 'progress') {
            totalAttempts += message.attempts;
          }
        });

        worker.on('error', (error) => {
          console.error('\n[Main] Worker error:', error);
        });

        worker.on('exit', (code) => {
          workers.delete(worker);
          if (workers.size === 0 && !resultFound) {
            clearInterval(progressInterval);
            clearTimeout(timeout);
            console.log('\n[Main] All workers have exited.');
            reject(new Error('All workers exited without finding a result'));
          }
        });
      }
    } else {
      // Suppress warnings in worker thread
      process.removeAllListeners('warning');
      process.on('warning', (warning) => {
        if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
          return;
        }
        console.warn(warning);
      });

      const { prefix, suffix } = workerData;
      let attempts = 0;

      function attemptGeneration() {
        const batchSize = 10000;
        for (let i = 0; i < batchSize; i++) {
          attempts++;
          const result = generateKeypair(prefix, suffix);
          if (result) {
            // Create token directory if it doesn't exist
            const tokenDir = path.join(__dirname, 'token');
            if (!fs.existsSync(tokenDir)) {
              fs.mkdirSync(tokenDir, { recursive: true });
            }

            // Save the secret key array to token.json
            fs.writeFileSync(
              path.join(tokenDir, 'token.json'),
              JSON.stringify(result.secretKeyArray)
            );

            parentPort.postMessage({ type: 'result', data: result });
            process.exit(0);
          }
        }
        parentPort.postMessage({ type: 'progress', attempts });
        attempts = 0;
        setImmediate(attemptGeneration);
      }

      attemptGeneration();
    }
  });
}

if (isMainThread) {
  if (require.main === module) {
    // Script is being run directly
    async function main() {
      try {
        const result = await generateSolanaVanityKeypair({
          suffix: 'pump',
          timeoutSeconds: 99999
        });
        console.log('\nGenerated keypair:', result);
      } catch (error) {
        console.error('\nError:', error.message);
      }
    }
    main();
  } else {
    // Script is being required as a module
    module.exports = { generateSolanaVanityKeypair };
  }
} else {
  // Suppress warnings in worker thread
  process.removeAllListeners('warning');
  process.on('warning', (warning) => {
    if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
      return;
    }
    console.warn(warning);
  });

  const { prefix, suffix } = workerData;
  let attempts = 0;

  function attemptGeneration() {
    const batchSize = 10000;
    for (let i = 0; i < batchSize; i++) {
      attempts++;
      const result = generateKeypair(prefix, suffix);
      if (result) {
        // Create token directory if it doesn't exist
        const tokenDir = path.join(__dirname, 'token');
        if (!fs.existsSync(tokenDir)) {
          fs.mkdirSync(tokenDir, { recursive: true });
        }

        // Save the secret key array to token.json
        fs.writeFileSync(
          path.join(tokenDir, 'token.json'),
          JSON.stringify(result.secretKeyArray)
        );

        parentPort.postMessage({ type: 'result', data: result });
        process.exit(0);
      }
    }
    parentPort.postMessage({ type: 'progress', attempts });
    attempts = 0;
    setImmediate(attemptGeneration);
  }

  attemptGeneration();
}