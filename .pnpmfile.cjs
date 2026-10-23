function readPackage(pkg, context) {
  if (pkg.name === '@michei69/node-smtc') {
    pkg.os = ['win32'];
  }
  return pkg;
}

module.exports = { readPackage };