var xhr = require('xhr')
var fs = require('fs')
var mustache = require('mustache').render
var dom = require('domquery')
var qs = require('querystring')

var remote = 'http://localhost:6461'
var state = {
  offset: 0
}

window.dom = dom // for debugging

var templates = {
  title: fs.readFileSync('./templates/title.html').toString(),
  generating: fs.readFileSync('./templates/generating.html').toString(),
  tableContainer: fs.readFileSync('./templates/tableContainer.html').toString(),
  actions: fs.readFileSync('./templates/actions.html').toString(),
  dataTable: fs.readFileSync('./templates/dataTable.html').toString(),
  metadata: fs.readFileSync('./templates/metadata.html').toString()
}

fetchMetadata(function(err, metadata) {
  if (err) return console.error(err)
  render('metadata', '#metadata', metadata)
  fetchAndRenderRows()
})

render('title', '.project-title', {db_name: 'Dat Database'})
render('tableContainer', '.right-panel')
activateControls()
// render('generating', '.project-actions')
// render('actions', '.project-actions', {db_name: 'Dat Database'} )

function fetchMetadata(cb) {
  xhr({ uri: remote + '/api', json: true }, function (err, resp, data) {
    if (data) state.dbInfo = data
    cb(err, data)
  })
}

function fetchAndRenderRows(opts) {
  if (!opts) {
    state.offset = 0
    opts = {}
  }
  
  var query = {
    start: opts.start,
    tail: opts.tail,
    limit: getPageSize()
  }
  
  if (typeof query.tail !== 'undefined') state.offset = state.dbInfo.rows - query.limit
  else if (typeof query.start !== 'undefined') state.offset = state.offset + query.limit
  
  var uri = remote + '/api/json?' + qs.stringify(query)
  
  xhr({ uri: uri, json: true }, function (err, resp, data) {
    if (err) return console.error(err)
    renderTable(data.rows)
  })
}

function render(template, target, data) {
  target = dom(target)
  var compiled = mustache(templates[template], data)
  target.html(compiled)
}

function renderTable(rows) {
  if (rows.length === 0) return render('dataTable', '.data-table-container')
  
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
  
  dom('.viewpanel-pagingcount').text((state.offset + 1) + " - " + (state.offset + getPageSize()))
  
  state.newest = rows[0].key
  state.oldest = rows[rows.length - 1].key
  
  if (state.offset + getPageSize() >= state.dbInfo.doc_count) {
    deactivate(dom( '.viewpanel-paging .last'))
    deactivate(dom( '.viewpanel-paging .next'))
  } else {
    activate(dom( '.viewpanel-paging .last'))
    activate(dom( '.viewpanel-paging .next'))
  }

  if (state.offset === 0) {
    deactivate(dom( '.viewpanel-paging .previous'))
    deactivate(dom( '.viewpanel-paging .first'))
  } else {
    activate(dom( '.viewpanel-paging .previous'))
    activate(dom( '.viewpanel-paging .first'))
  }
}

function activate(e) {
  e.removeClass('inaction').addClass('action')
}

function deactivate(e) {
  e.removeClass('action').addClass('inaction')
}

function activateControls() {
  dom('.viewPanel-pagingControls-page').on('click', function (event) {
    dom(".viewpanel-pagesize .selected").removeClass('selected')
    dom(event.target).addClass('selected')
    fetchAndRenderRows(state.newest)
  })
  dom( '.viewpanel-paging a' ).on('click', function( e ) {
    var action = dom(e.target)
    if (action.hasClass("last")) {
      fetchAndRenderRows({tail: getPageSize()})
    }
    if (action.hasClass("next")) {
      fetchAndRenderRows({start: state.oldest})
    }
    if (action.hasClass("previous")) {
      fetchAndRenderRows()
    }
    if (action.hasClass("first")) {
      fetchAndRenderRows()
    }
  })
}

function getPageSize() {
  var pagination = dom(".viewpanel-pagesize .selected")
  if (pagination.length > 0) {
    return parseInt(pagination.text())
  } else {
    return 10;
  }
}
