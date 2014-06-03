var xhr = require('xhr')
var fs = require('fs')
var mustache = require('mustache').render
var dom = require('domquery')

window.dom = dom // for debugging

var templates = {
  title: fs.readFileSync('./templates/title.html').toString(),
  generating: fs.readFileSync('./templates/generating.html').toString(),
  tableContainer: fs.readFileSync('./templates/tableContainer.html').toString(),
  actions: fs.readFileSync('./templates/actions.html').toString(),
  dataTable: fs.readFileSync('./templates/dataTable.html').toString()
}

function render(template, target, data) {
  target = dom(target)
  var compiled = mustache(templates[template], data)
  target.html(compiled)
}

var remote = 'http://localhost:6461'
var opts = { uri: remote + '/api/json', json: true }

xhr(opts, function (err, resp, data) {
  var rows = data.rows
  if (rows.length === 0) return render('dataTable', '.data-table-container')
  
  dom('#docCount').text(rows.length + " documents")
  
  var headers = Object.keys(rows[0])
  var tableRows = []
  
  rows.map(function(row) {
    var cells = []
    headers.map(function(header) {
      var value = ""
      if (row[header]) {
        value = row[header]
        if (typeof(value) == "object") value = JSON.stringify(value)
      }
      cells.push({header: header, value: value})
    })
    tableRows.push({key: row.key, cells: cells})
  })
  
  render('dataTable', '.data-table-container', {
    rows: tableRows,
    headers: headers,
    notEmpty: true
  })
})

render('title', '.project-title', {db_name: 'Database'})
render('generating', '.project-actions')
render('tableContainer', '.right-panel')
render('actions', '.project-actions', {db_name: 'Database'} )
