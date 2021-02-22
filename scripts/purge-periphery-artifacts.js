const fs = require('fs');
const path = require('path');

const contractsRoot = path.join(__dirname, '..', 'contracts');
const interfaces = path.join(contractsRoot, 'interfaces');
const controller = path.join(contractsRoot, 'controller');
const committee = path.join(contractsRoot, 'committee');
const balancer = path.join(contractsRoot, 'balancer');

const getSolFiles = (dir) => fs.readdirSync(dir).filter(f => f.includes('.sol'));

const keepFiles = [
  ...getSolFiles(contractsRoot),
  ...getSolFiles(interfaces),
  ...getSolFiles(controller),
  ...getSolFiles(committee),
  ...getSolFiles(balancer),
  'WeightingLibrary.sol',
  'TokenSortLibrary.sol'
].map(f => f.replace('.sol', '.json'));

const artifactsPath = path.join(__dirname, '..', 'artifacts');

const allArtifacts = fs.readdirSync(artifactsPath);

for (let artifact of allArtifacts) {
  if (!keepFiles.includes(artifact)) {
    const artifactPath = path.join(artifactsPath, artifact);
    fs.unlinkSync(artifactPath);
  }
}
