/**
 * CSInterface.js — Adobe CEP Bridge
 * Works inside Premiere Pro (real CEP runtime) AND in browser preview (mock mode).
 * Based on Adobe's official CSInterface API.
 */

var SystemPath = {
  APPLICATION: 'application',
  EXTENSION:   'extension',
  USER_DATA:   'userData',
  TEMP:        'temp',
  MY_DOCUMENTS:'myDocuments'
};

function CSInterface() {
  this._isCEP = !!(window.__adobe_cep__);
}

/**
 * Call an ExtendScript function (runs inside Premiere Pro).
 * @param {string} script - JavaScript/ExtendScript code to evaluate
 * @param {function} callback - receives the string result
 */
CSInterface.prototype.evalScript = function(script, callback) {
  if (this._isCEP) {
    window.__adobe_cep__.evalScript(script, callback || function(){});
  } else {
    // Browser dev/preview mode — return mock success
    var fnMatch = script.match(/hostBridge\(['"](\w+)['"]/);
    var fnName  = fnMatch ? fnMatch[1] : 'unknown';
    console.log('[CSInterface] Mock evalScript → ' + fnName);
    if (callback) {
      setTimeout(function() {
        callback(JSON.stringify({ success: true, mock: true, fn: fnName }));
      }, 80);
    }
  }
};

CSInterface.prototype.addEventListener = function(type, listener) {
  if (this._isCEP) window.__adobe_cep__.addEventListener(type, listener);
};

CSInterface.prototype.dispatchEvent = function(event) {
  if (this._isCEP) window.__adobe_cep__.dispatchEvent(event);
};

CSInterface.prototype.getSystemPath = function(pathType) {
  if (this._isCEP) {
    var result = window.__adobe_cep__.getSystemPath(pathType);
    return result ? JSON.parse(result) : '';
  }
  // Browser fallback paths
  var fallbacks = {
    extension: './ican-film-editor',
    userData:  'C:/Users/jhabi',
    temp:      'C:/Temp'
  };
  return fallbacks[pathType] || '';
};

CSInterface.prototype.openURLInDefaultBrowser = function(url) {
  window.open(url, '_blank');
};

CSInterface.prototype.getApplicationID = function() {
  if (this._isCEP) return window.__adobe_cep__.getApplicationID();
  return 'PPRO';
};

CSInterface.prototype.getExtensionID = function() {
  return 'com.icanfilm.editor.panel';
};
