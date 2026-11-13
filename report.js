/**
 * The page an emailed report link opens.
 *
 * The address fragment carries the project and a read-only link, issued by
 * `send-report` for 30 days, to a short list of the report's parts. The page
 * fetches that list and each part from the backend, joins them and hands the
 * browser one PDF. The fragment is never sent to this page's host, and nothing
 * here is sent anywhere but the backend below.
 *
 * Paths from the fragment and the list are only ever appended to `API`, so a
 * crafted link cannot point this page at another server.
 */
(function () {
  'use strict';

  var API = 'https://xcitedb.net';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function show(id) {
    ['loading', 'ready', 'expired', 'broken', 'failed'].forEach(function (name) {
      document.getElementById(name).hidden = name !== id;
    });
  }

  function progress(done, total) {
    var percent = total ? Math.round((done / total) * 100) : 0;
    document.getElementById('progress').style.width = percent + '%';
    document.querySelector('.bar').setAttribute('aria-valuenow', String(percent));
  }

  function params() {
    var out = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (pair) {
      var at = pair.indexOf('=');
      if (at > 0) {
        try { out[pair.slice(0, at)] = decodeURIComponent(pair.slice(at + 1)); } catch (e) { /* ignored */ }
      }
    });
    return out;
  }

  /** A gone link and a gone report look the same to a patient: both are over. */
  function Expired() {}

  function get(path, project, as) {
    return fetch(API + path, { headers: { 'X-Project-Id': project }, cache: 'no-store', credentials: 'omit' })
      .then(function (res) {
        if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410) throw new Expired();
        if (!res.ok) throw new Error('http_' + res.status);
        return as === 'json' ? res.json() : res.arrayBuffer();
      });
  }

  function safeName(name) {
    var cleaned = String(name || '').replace(/[\/\\:*?"<>|\u0000-\u001f]/g, ' ').trim();
    return /\.pdf$/i.test(cleaned) ? cleaned : 'report.pdf';
  }

  function untilText(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return null;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return {
      en: 'Available until ' + date.getUTCDate() + ' ' + MONTHS[date.getUTCMonth()] + ' ' + date.getUTCFullYear() + '.',
      he: 'זמין עד ' + pad(date.getUTCDate()) + '.' + pad(date.getUTCMonth() + 1) + '.' + date.getUTCFullYear() + '.'
    };
  }

  var objectUrl = null;

  function load() {
    var p = params();
    var project = p.p || '';
    var list = p.m || '';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(project) || list.indexOf('/api/v1/json-documents?') !== 0) {
      show('broken');
      return;
    }
    show('loading');
    progress(0, 1);
    get(list, project, 'json')
      .then(function (doc) {
        var data = doc && doc.data && typeof doc.data === 'object' ? doc.data : doc;
        var parts = data && data.parts;
        if (!Array.isArray(parts) || parts.length === 0 || !parts.every(function (part) {
          return typeof part === 'string' && part.indexOf('/api/v1/assets/') === 0;
        })) throw new Error('bad_list');
        var chunks = [];
        var next = function (i) {
          if (i === parts.length) return chunks;
          return get(parts[i], project, 'bytes').then(function (bytes) {
            chunks.push(bytes);
            progress(i + 1, parts.length);
            return next(i + 1);
          });
        };
        return Promise.resolve(next(0)).then(function () { return { data: data, chunks: chunks }; });
      })
      .then(function (result) {
        var blob = new Blob(result.chunks, { type: 'application/pdf' });
        var head = new Uint8Array(result.chunks[0], 0, Math.min(5, result.chunks[0].byteLength));
        var isPdf = String.fromCharCode.apply(null, Array.prototype.slice.call(head)) === '%PDF-';
        if (!isPdf || (typeof result.data.size === 'number' && blob.size !== result.data.size)) throw new Error('bad_file');
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(blob);
        var open = document.getElementById('open');
        var save = document.getElementById('save');
        open.href = objectUrl;
        save.href = objectUrl;
        save.setAttribute('download', safeName(result.data.fileName));
        var until = untilText(result.data.expiresAt);
        document.getElementById('until-en').textContent = until ? until.en : '';
        document.getElementById('until-he').textContent = until ? until.he : '';
        show('ready');
      })
      .catch(function (error) {
        show(error instanceof Expired ? 'expired' : 'failed');
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('retry').addEventListener('click', load);
    window.addEventListener('hashchange', load);
    load();
  });
})();
