const fs = require('fs');
const path = require('path');

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Invalid version format. Expected: X.Y.Z');
  process.exit(1);
}

const packagePath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.version = version;
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Version bumped to ${version}`);
