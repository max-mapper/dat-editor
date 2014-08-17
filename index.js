var xhr = require('xhr')
var fs = require('fs')
var url = require('url')
var mustache = require('mustache').render
var dom = require('domquery')
var domify = require('domify')
var offset = require('offset')
var qs = require('querystring')
var on = require('component-delegate').bind
var parents = require('closest')
var siblings = require('siblings')
var addCommas = require('add-commas')
var drop = require('drag-and-drop-files')
var guessType = require('streamcast')
var fsReadStream = require('filereader-stream')
var headStream = require('head-stream')
var htmlStringify = require('html-stringify')

function noop() {}

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
  controls: fs.readFileSync('./templates/controls.html').toString(),
  actions: fs.readFileSync('./templates/actions.html').toString(),
  inspect: fs.readFileSync('./templates/inspect.html').toString(),
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
  cellEditor: fs.readFileSync('./templates/cellEditor.html').toString(),
  networkError: fs.readFileSync('./templates/networkError.html').toString(),
  signIn: fs.readFileSync('./templates/signIn.html').toString()
}

module.exports = function(opts) {
  if (!opts) opts = {}
  
  var state = {}
  
  state.remote = opts.remote
  
  if (!state.remote) {
    var parsed = url.parse(window.location.href, true)
    if (parsed.query) state.remote = parsed.query.remote
  }
  
  if (!state.remote) state.remote = window.location.origin
  
  var actions = {
    bulkEdit: function() { showDialog('bulkEdit', {name: 'COLUMN'}) },
    transform: function() { showDialog('transform') },
    csv: function() { window.location.href = state.remote + '/api/csv' },
    json: function() { window.location.href = state.remote + "/api/rows?limit=-1" },
    urlImport: function() { showDialog('urlImport') },
    pasteImport: function() { showDialog('pasteImport') },
    uploadImport: function() { showDialog('uploadImport') },
  }

  refreshTable()

  render('tableContainer', '.right-panel')
  // render('generating', '.project-actions')
  render('actions', '.project-actions')

  activateControls()

  var menu = dom('.menu')
  var menuOverlay = dom('.menu-overlay')
  var dialog = dom('.dialog')
  var dialogOverlay = dom('.dialog-overlay')

  bindEvents()
  getSession()
  
  function getSession() {
    xhr({ uri: state.remote + '/api/session', json: true, cors: true }, function (err, resp, json) {
      if ( json.loggedOut ) {
        var text = "Sign in"
      } else if (json.session) {
        var text = "Sign out"
      } else {
        return
      }
      render('controls', '.project-controls', {text: text});
    })
  }
  
  function bindEvents() {
    
    function killEvent(e) {
      e.stopPropagation()
      e.preventDefault()
      return false
    }
    
    on(document.body, '.uploadImportContainer', 'dragenter', killEvent)
    on(document.body, '.uploadImportContainer', 'dragover', killEvent)
    
    on(document.body, '.uploadImportContainer', 'drop', function(e) {
      killEvent(e)
      var files = Array.prototype.slice.call(e.dataTransfer.files)
      var first = files[0]
      
      function upload(file, type) {
        var headers = {"content-type": type}
        var progressBar = dom('<progress max="100" value="0"></progress>')
        dom('.uploadImportContainer .dialog-body .grid-layout').add(progressBar)
        
        var req = xhr({uri: state.remote + '/api/bulk', method: "POST", timeout: 0, body: file, cors: true, headers: headers, onUploadProgress: onProgress}, function(err, resp, body) {
          if (err) notify(err)
          refreshTable()
          dialog.hide()
          dialogOverlay.hide()
        })
        
        function onProgress(e) {
          if (e.lengthComputable) {
            var progress = ((e.loaded / e.total) * 100)
            progressBar.attr('value', progress)
          }
        }
      }
      
      var read = fsReadStream(first)
      var head = headStream(onFirstRow)
      
      read.on('error', noop) // ignore errors
      
      function onFirstRow(buffer, done) {
        var type = guessType(buffer, {filename: first.name})
        if (type === 'ldjson' || type === 'csv') {
          var contentType
          if (type === 'ldjson') contentType = 'application/json'
          if (type === 'csv') contentType = 'text/csv'
          upload(first, contentType)
        } else {
          dialog.hide()
          dialogOverlay.hide()
          notify('File type not supported')
        }
        read.abort()
        done()
      }
      
      read.pipe(head)
    })
    
    on(document.body, '.uploadBlob', 'change', function(e) {
      e.preventDefault()
      var files = Array.prototype.slice.call(e.target.files)
      var first = files[0]
      var container = parents(e.target, '.inspectContainer')
      var key = dom(container).attr('data-key')
      var row = state.rows[key]
      
      var uploaderEl = dom('.blobUploader')
      uploaderEl.html('<progress max="100" value="0"></progress>')
      var progressBar = uploaderEl.select('progress')
      
      var uri = state.remote + '/api/rows/' + row.key + '/' + first.name + '?version=' + row.version
      
      var req = xhr({uri: uri, method: "POST", timeout: 0, body: first, cors: true, onUploadProgress: onProgress}, function(err, resp, body) {
        if (err) notify(err)
        var updated = JSON.parse(body)
        state.rows[updated.key] = updated
        showInspector(updated)
      })
      
      function onProgress(e) {
        if (e.lengthComputable) {
          var progress = ((e.loaded / e.total) * 100)
          progressBar.attr('value', progress)
        }
      }
    })
    
    on(document.body, '#view-panel .viewpanel-key', 'change', function(e) {
      var input = dom(e.target)
      var val = input.val()
      refreshTable({start: val})
    })
    
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
    
    on(document.body, '#logged-in-status', 'click', function(e) {
      var text = dom(e.target).text()
      if (text === "Sign in") {
        showDialog("signIn")
      } else if (text === "Sign out") {
        notify("Signing you out...", {persist: true, loader: true})
        xhr({ uri: state.remote + '/api/logout', json: true, cors: true }, function (err, resp, json) {
          notify("Signed out")
          render('controls', '.project-controls', {text: "Sign in"})
        })
      }
    })
    
    on(document.body, '.signInContainer .okButton', 'click', function(e) {
      var container = parents(e.target, '.signInContainer')
      var user = dom(container).select('#username-input').val()
      var pass = dom(container).select('#password-input').val()
      var headers = {authorization: 'Basic ' + btoa(user + ':' + pass)}
      xhr({ uri: state.remote + '/api/session', json: true, headers: headers, cors: true }, function (err, resp, json) {
        if (err) return notify('Login error! ' + err.message)
        if (json.loggedOut) return notify('Invalid username or password')
        notify('Logged in')
        render('controls', '.project-controls', {text: 'Sign out'})
        dialog.hide()
        dialogOverlay.hide()
      })
    })
    
    on(document.body, '#sign-in-form', 'submit', function(e) {
      var container = parents(e.target, '.signInContainer')
      e.preventDefault()
      var button = dom(container).select('.okButton')[0]
      var click = document.createEvent('HTMLEvents')
      click.initEvent('click', true, false)
      button.dispatchEvent(click)
    })
    
    on(document.body, '.data-table-cell-edit', 'click', function(e) {
      var editContainer = dom('.data-table-cell-editor')
      if (editContainer.length > 0) closeCellEdit(editContainer[0])
      dom(e.target).addClass("hidden")
      var cell = dom(siblings(e.target, '.data-table-cell-value')[0])
      render('cellEditor', cell, {value: cell.text()})
    })

    on(document.body, '.data-table-cell-editor-action .cancelButton', 'click', function(e) {
      var editContainer = dom('.data-table-cell-editor')
      if (editContainer.length > 0) closeCellEdit(editContainer[0])
    })

    on(document.body, '.json-paste-import .okButton', 'click', function(e) {
      var container = parents(e.target, '.json-paste-import')
      var textarea = dom(container).select('.data-table-cell-copypaste-editor')
      var input = textarea.val()
      if (input.length === 0) return notify('No JSON in input!')
  
      try {
        var rows = input.split(/\r?\n/)
        var objects = []
        rows.map(function(r) { if (r.length > 0) objects.push(JSON.parse(r)) })
      } catch(e) {
        return notify('Could not parse newline separated JSON --- Invalid JSON')
      }
  
      notify('Uploading data...')
  
      xhr({uri: state.remote + '/api/bulk?results=true', method: "POST", body: input, cors: true, headers: {"content-type": "application/json"}}, function(err, resp, body) {
        if (err) return notify(err)
        var lines = body.split(/\r?\n/)
        var created = []
        var updated = []
        var conflicts = []
        lines.map(function(r) {
          if (r.length === 0) return
          var row = JSON.parse(r)
          if (row.conflict) conflicts.push(row)
          else if (row.version === 1) created.push(row)
          else updated.push(row)
        })
        notify("New: " + created.length + ' rows, updated: ' + updated.length + ' rows, conflicts: ' + conflicts.length + ' rows')
        refreshTable()
      })
      dialog.hide()
      dialogOverlay.hide()
    })
    
    on(document.body, '.row-header-menu', 'click', function(e) {
      var tr = parents(e.target, 'tr')
      var key = dom(tr).attr('data-key')
      var row = state.rows[key]
      showInspector(row)
    })
    
    on(document.body, '.data-table-cell-editor-action .okButton', 'click', function(e) {
      var editContainer = parents(e.target, '.data-table-cell-editor')
      var editor = dom(editContainer).select('.data-table-cell-editor-editor')
      var updated = editor.val()
      var tr = parents(editContainer, 'tr')
      var td = parents(editContainer, 'td')
      var key = dom(tr).attr('data-key')
      var column = dom(td).attr('data-header')
      var row = state.rows[key]
      row[column] = updated
      closeCellEdit(editContainer)
      post(row, function(err) {
        if (err) notify(err.message)
      })
    })
  }
  
  function closeCellEdit(editContainer) {
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

  function post(row, cb) {
    if (!cb) cb = noop
    notify('Updating row...')
    xhr({ uri: state.remote + '/api/rows/' + row.key, method: 'POST', json: row, cors: true }, function (err, resp, data) {
      if (err) return cb(err)
      refreshTable(function(err) {
        if (err) return cb(err)
        notify('Updated row ' + data.key + ' to version ' + data.version)
        cb(null, data)
      })
    })
  }
  
  function showInspector(row) {
    var prettyHtml = htmlStringify(row)
    var attachmentData = []
    var attachments = row.blobs || {}
    Object.keys(attachments).map(function(key) {
      attachmentData.push({
        name: key,
        url: state.remote + '/api/rows/' + row.key + '/' + key
      })
    })
    
    showDialog('inspect', {
      html: prettyHtml,
      blobs: attachmentData,
      hasAttachments: attachmentData.length > 0,
      key: row.key
    })
  }
  
  function refreshTable(opts, cb) {
    fetchAndRenderMetadata(function(err) {
      fetchAndRenderRows(opts, function(err2) {
        if (cb) cb(err || err2)
      })
    })
  }

  function fetchAndRenderMetadata(cb) {
    xhr({ uri: state.remote + '/api', json: true, cors: true }, function (err, resp, data) {
      if (err) render('networkError', '.data-table-container', state)
      if (data) state.dbInfo = data
      render('title', '.project-title', {db_name: data.name || 'Dat Database'})
      render('metadata', '#metadata', {rows: addCommas(data.rows || 0)})
      cb(err, data)
    })
  }

  function fetchAndRenderRows(opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = undefined
    }
    
    if (!opts) {
      opts = {}
    }
    
    if (!cb) cb = noop
    
    var query = {
      limit: getPageSize()
    }
    
    if (opts.start) query.start = opts.start
    if (opts.gt) query.gt = opts.gt
    if (opts.lt) query.lt = opts.lt
    if (opts.gte) query.gte = opts.gte
    if (opts.lte) query.lte = opts.lte
    if (opts.reverse) query.reverse = opts.reverse
    
    var uri = state.remote + '/api/rows?' + qs.stringify(query)
    
    xhr({ uri: uri, json: true, cors: true }, function (err, resp, data) {
      if (err) {
        render('networkError', '.data-table-container')
        return cb(err)
      }
      if (data.rows.length > 0) {
        var rows = {}
        data.rows.map(function(r) { rows[r.key] = r })
        // sort by key before rendering (for ?reverse=true queries)
        data.rows.sort(function(a, b) { return a.key > b.key })
        state.rows = rows
        renderTable(data.rows)
      }
      cb(null)
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
  
    state.newest = rows[0].key
    state.oldest = rows[rows.length - 1].key
    
    dom('.viewpanel-key').val(state.newest)

    // if (state.offset + getPageSize() >= state.dbInfo.rows) {
    //   deactivate(dom( '.viewpanel-paging .last'))
    //   deactivate(dom( '.viewpanel-paging .next'))
    // } else {
    //   activate(dom( '.viewpanel-paging .last'))
    //   activate(dom( '.viewpanel-paging .next'))
    // }
    //
    // if (state.offset === 0) {
    //   deactivate(dom( '.viewpanel-paging .previous'))
    //   deactivate(dom( '.viewpanel-paging .first'))
    // } else {
    //   activate(dom( '.viewpanel-paging .previous'))
    //   activate(dom( '.viewpanel-paging .first'))
    // }
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
      refreshTable(state.newest)
    })
    dom( '.viewpanel-paging a' ).on('click', function( e ) {
      var action = dom(e.target)
      if (action.hasClass("last")) {
        refreshTable({reverse: true})
      }
      if (action.hasClass("next")) {
        refreshTable({gt: state.oldest})
      }
      if (action.hasClass("previous")) {
        refreshTable({lt: state.newest, reverse: true})
      }
      if (action.hasClass("first")) {
        refreshTable()
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

  function notify( message, options ) {
    if (!options) var options = {};
    dom('#notification-container').show()
    dom('#notification-message').text(message)
    if (!options.loader) dom('.notification-loader').hide()
    if (options.loader) dom('.notification-loader').show()
    if (state.notifyTimeout) clearTimeout(state.notifyTimeout)
    if (!options.persist) state.notifyTimeout = setTimeout(function() { dom('#notification-container').hide() }, 3000)
  }
}
