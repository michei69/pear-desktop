function readPackage(pkg, context) {
  if (pkg.name === 'node-smtc') {
    pkg.os = ['win32'];
  }
  return pkg;
}

module.exports = { readPackage };