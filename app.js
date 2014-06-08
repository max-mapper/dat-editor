var xhr = require('xhr')
var fs = require('fs')
var mustache = require('mustache').render
var dom = require('domquery')
var offset = require('offset')
var qs = require('querystring')
var on = require('component-delegate').bind
var parents = require('closest')
var siblings = require('siblings')

var remote = 'http://localhost:6461'
var state = {
  offset: 0
}

window.dom = dom // for debugging
window.offset = offset
window.parents = parents
window.siblings = siblings

var templates = {
  title: fs.readFileSync('./templates/title.html').toString(),
  generating: fs.readFileSync('./templates/generating.html').toString(),
  tableContainer: fs.readFileSync('./templates/tableContainer.html').toString(),
  dataTable: fs.readFileSync('./templates/dataTable.html').toString(),
  metadata: fs.readFileSync('./templates/metadata.html').toString(),
  actions: fs.readFileSync('./templates/actions.html').toString(),
  rowActions: fs.readFileSync('./templates/rowActions.html').toString(),
  columnActions: fs.readFileSync('./templates/columnActions.html').toString(),
  importActions: fs.readFileSync('./templates/importActions.html').toString(),
  exportActions: fs.readFileSync('./templates/exportActions.html').toString(),
  transformActions: fs.readFileSync('./templates/transformActions.html').toString(),
  urlImport: fs.readFileSync('./templates/urlImport.html').toString(),
  pasteImport: fs.readFileSync('./templates/pasteImport.html').toString(),
  uploadImport: fs.readFileSync('./templates/uploadImport.html').toString(),
  transform: fs.readFileSync('./templates/transform.html').toString(),
  bulkEdit: fs.readFileSync('./templates/bulkEdit.html').toString(),
  cellEditor: fs.readFileSync('./templates/cellEditor.html').toString()
}

var actions = {
  bulkEdit: function() { showDialog('bulkEdit', {name: 'COLUMN'}) },
  transform: function() { showDialog('transform') },
  csv: function() { window.location.href = remote + '/api/csv' },
  json: function() { window.location.href = remote + "/api/json?limit=-1" },
  urlImport: function() { showDialog('urlImport') },
  pasteImport: function() { showDialog('pasteImport') },
  uploadImport: function() { showDialog('uploadImport') },
}

fetchMetadata(function(err, metadata) {
  if (err) return console.error(err)
  render('metadata', '#metadata', metadata)
  fetchAndRenderRows()
})

render('title', '.project-title', {db_name: 'Dat Database'})
render('tableContainer', '.right-panel')
// render('generating', '.project-actions')
render('actions', '.project-actions', {db_name: 'Dat Database'} )

activateControls()

var menu = dom('.menu')
var menuOverlay = dom('.menu-overlay')
var dialog = dom('.dialog')
var dialogOverlay = dom('.dialog-overlay')

on(document.body, '.project-actions .button', 'click', function(e) {
  var el = e.target
  if (!dom(el).hasClass('button')) el = parents(el, '.button')
  var action = dom(el).attr('data-action')
  render(action + 'Actions', '.menu')
  position(menu, el, {left: -60, top: 0})
  menuOverlay.show()
})

on(document.body, '.menu-overlay', 'click', function(e) {
  menu.hide()
  menuOverlay.hide()
})

on(document.body, '.dialog-overlay', 'click', function(e) {
  dialog.hide()
  dialogOverlay.hide()
})

on(document.body, '.cancelButton', 'click', function(e) {
  dialog.hide()
  dialogOverlay.hide()
})

on(document.body, '.menu li', 'click', function(e) {
  var action = dom(e.target).attr('data-action')
  var actionFunc = actions[action]
  if (actionFunc) actionFunc()
})

on(document.body, '.data-table-cell-edit', 'click', function(e) {
  var editContainer = dom('.data-table-cell-editor')
  if (editContainer.length > 0) cancelCellEdit(editContainer[0])
  dom(e.target).addClass("hidden")
  var cell = dom(siblings(e.target, '.data-table-cell-value')[0])
  render('cellEditor', cell, {value: cell.text()})
})

on(document.body, '.data-table-cell-editor-action .cancelButton', 'click', function(e) {
  var editContainer = dom('.data-table-cell-editor')
  if (editContainer.length > 0) cancelCellEdit(editContainer[0])
})

function cancelCellEdit(editContainer) {
  var editor = dom(editContainer).select('.data-table-cell-editor-editor')
  var cellValue = editContainer.parentNode
  var cell = cellValue.parentNode
  dom(cellValue).html(editor.text())
  dom(cell).select('.data-table-cell-edit').removeClass('hidden')
}

function showDialog(template, data) {
  if (!data) data = {};
  dialog.show()
  dialogOverlay.show()
  render(template, '.dialog-content', data)
}

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
  if (typeof target === 'string') target = dom(target)
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

function position(thing, elem, adjust) {
  var position = offset(elem)
  if (!adjust) adjust = {top: 0, left: 0}
  var top = (position.top + elem.offsetHeight) + (adjust.top || 0)
  var left = position.left + (adjust.left || 0)
  var styles = { top: top + 'px', left: left + 'px' }
  thing
    .show()
    .style(styles)
    .on('click', function(e) {
      thing.hide()
      menuOverlay.hide()
    })
}
