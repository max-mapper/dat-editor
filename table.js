var mercury = require('mercury')
var h = mercury.h

module.exports = function(data) {
  var rowData = mercury.array(data.map(function(f) {
    var dynHash = {}
    Object.keys(f).map(function(k) {
      dynHash[k] = mercury.value(f[k])
    })
    return mercury.hash(dynHash)
  }))

  return {
    state: rowData,
    render: render
  }
  
}

function render(data) {
  var first = data[0]
  if (first._diff) delete first._diff
  var keys = Object.keys(first)
  return table(keys, data)
}

function table(keys, data){
  return h('table.data-table', {cellspacing: 0}, [
    header(keys),
    rows(keys, data)
  ])
}

function header(keys) {
  return h('thead', keys.map(function(k) {
    return h('th.tl.cell.column-header.b.bgy', k)
  }))
}

function rows(keys, data) {
  return h('tbody.data-table-body',
    data.map(function (d, i) {
      return row(keys, d, i)
    })
  )
}

function row(keys, data, rowNum) {
  return h('tr.table-row',
    {'data-key': rowNum},
    keys.map(function (k, i) {
      return cell(k, data[k].toString())
    })
  )
}

function cell(key, val) {
  return h('td.c', {
    'data-header': key
  }, [
    h('div.cv', val)
  ])
}
