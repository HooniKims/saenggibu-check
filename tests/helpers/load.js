// SGB 모듈을 Node 컨텍스트에 로드한다.
// 기존 모듈이 이중 런타임(브라우저/Node)으로 작성돼 있어 vm 으로 그대로 평가하면 된다.
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '../..');

function loadSGB(names) {
  globalThis.XLSX = require(path.join(ROOT, 'assets/vendor/xlsx.full.min.js'));
  names.forEach(function (n) {
    var src = fs.readFileSync(path.join(ROOT, 'assets/js', n), 'utf8');
    vm.runInThisContext(src, { filename: n });
  });
  return globalThis.SGB;
}

module.exports = { loadSGB: loadSGB, ROOT: ROOT };
