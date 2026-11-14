(function () {
  "use strict";

  /* ---------- constants ---------- */
  var SEASONS = [["spring", "Spring clean-up"], ["summer", "Summer mowing"], ["fall", "Fall clean-up"], ["winter", "Winter clean-up"]];
  var TYPES = [["lawn", "Lawn care"], ["landscape", "Landscaping"]];
  var UNITS = [["yard", "per yard"], ["flat", "flat price"], ["hour", "per hour"], ["each", "each"]];
  var UNIT_SHORT = { yard: " yd", hour: " hr" };
  var JOB = [["todo", "To do"], ["scheduled", "Scheduled"], ["progress", "In progress"], ["done", "Done"]];
  var BILL = [["unbilled", "Not billed"], ["invoiced", "Invoiced"], ["partial", "Partly paid"], ["paid", "Paid"]];
  var JOB_TONE = { todo: "muted", scheduled: "info", progress: "warn", done: "good" };
  var BILL_TONE = { unbilled: "muted", invoiced: "info", partial: "warn", paid: "good" };
  var FILTERS = [["all", "All"], ["todo", "To do"], ["tobill", "Needs a bill"], ["unpaid", "Unpaid"], ["overdue", "Overdue"], ["done", "Done and paid"]];
  var TABS = [["overview", "Overview"], ["jobs", "Jobs"], ["clients", "Clients"], ["invoices", "Invoices"], ["services", "Services"], ["settings", "Settings"]];
  var DEFAULTS = { businessName: "Lima's Landscaping", businessAddress: "1870 W Apricot Ln\nLincoln, NE 68522", businessPhone: "402-217-5496\n402-217-5497", businessWebsite: "www.limaslandscaping.com", businessSocial: "LIMAS LANDSCAPING", invoiceNote: "Thank you for your business!", nextInvoiceNo: 1001, logoData: "", dueDays: 14, warnAfterDays: 20, notify: true, lastNotified: "" };
  var LATE_DAYS = 30;

  /* ---------- helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }
  function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function money(n) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0); }
  function qtyFmt(n) { return String(Math.round(n * 100) / 100); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function dstr(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return dstr(new Date()); }
  function parseD(s) { var p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(s, n) { var d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); }
  function daysBetween(a, b) { return Math.round((parseD(b) - parseD(a)) / 86400000); }
  function fmtDate(s) { return s ? parseD(s).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""; }
  function fmtDateLong(s) { return s ? parseD(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : ""; }
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function lookup(list, key) { for (var i = 0; i < list.length; i++) if (list[i][0] === key) return list[i][1]; return key; }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /* ---------- state ---------- */
  var data = { jobs: [], clients: [], services: [], invoices: [], settings: {} };
  var locked = false;
  var ready = false;
  var appVersion = "";
  var PAGE = 60;
  var ui = { tab: "overview", jobFilter: "all", jobType: "all", sort: "newest", jq: "", cFilter: "all", cq: "", form: null, confirm: null, batch: false, invoice: null, iq: "", invLimit: PAGE, jobLimit: PAGE, clientLimit: PAGE };

  function st(k) { return data.settings[k] === undefined ? DEFAULTS[k] : data.settings[k]; }
  var clientIndex = {};
  function rebuildIndex() {
    clientIndex = {};
    data.clients.forEach(function (c) { clientIndex[c.id] = c; });
  }
  function clientById(id) {
    if (!id) return undefined;
    return clientIndex[id] || data.clients.filter(function (c) { return c.id === id; })[0];
  }
  function clientByName(n) {
    n = String(n || "").trim().toLowerCase();
    if (!n) return undefined;
    return data.clients.filter(function (c) { return String(c.name || "").trim().toLowerCase() === n; })[0];
  }
  function serviceByName(n) {
    n = String(n || "").trim().toLowerCase();
    if (!n) return undefined;
    return data.services.filter(function (s) { return s.code && String(s.code).trim().toLowerCase() === n; })[0] ||
      data.services.filter(function (s) { return String(s.name || "").trim().toLowerCase() === n; })[0];
  }
  function jobById(id) { return data.jobs.filter(function (j) { return j.id === id; })[0]; }
  function cname(j) { var c = clientById(j.clientId); return (c && c.name) || j.clientName || j.client || "Unnamed client"; }
  function hasItems(j) { return Array.isArray(j.items) && j.items.length > 0; }
  function jobTotal(j) {
    if (hasItems(j)) return r2(j.items.reduce(function (s, i) { return s + (Number(i.qty) || 0) * (Number(i.rate) || 0); }, 0));
    return Number(j.amount) || 0;
  }
  function balance(j) {
    var a = jobTotal(j);
    if (j.billStatus === "paid") return 0;
    if (j.billStatus === "partial") return Math.max(0, r2(a - (Number(j.amountPaid) || 0)));
    if (j.billStatus === "invoiced") return a;
    return 0;
  }
  function isOwed(j) { return j.billStatus === "invoiced" || j.billStatus === "partial"; }
  function isOverdue(j) { return isOwed(j) && j.dueDate && j.dueDate < today(); }
  function summary(j) {
    if (hasItems(j)) return j.items.map(function (i) { return i.name; }).join(", ");
    return j.description || "";
  }
  function unitLabel(u) { var f = UNITS.filter(function (x) { return x[0] === u; })[0]; return f ? f[1] : ""; }

  /* ---------- reminders ---------- */
  function billStart(j) { return j.completedDate || j.scheduled || dstr(new Date(j.createdAt || Date.now())); }
  function ageDays(j) { return Math.max(0, daysBetween(billStart(j), today())); }
  function warnDays() { return Math.min(LATE_DAYS - 1, Math.max(1, num(st("warnAfterDays"), 20))); }
  function waitingJobs() {
    return data.jobs.filter(function (j) { return j.jobStatus === "done" && j.billStatus === "unbilled"; })
      .map(function (j) { return { job: j, age: ageDays(j) }; })
      .sort(function (a, b) { return b.age - a.age; });
  }
  function billAlerts() { var w = warnDays(); return waitingJobs().filter(function (a) { return a.age >= w; }); }
  function ageLabel(age) {
    if (age >= LATE_DAYS) return [age === LATE_DAYS ? "A month late" : plural(age - LATE_DAYS, "day", "days") + " past a month", "bad"];
    if (age >= warnDays()) return [plural(LATE_DAYS - age, "day", "days") + " until a month late", "warn"];
    return ["Day " + age, "muted"];
  }

  /* ---------- persistence ---------- */
  var chain = Promise.resolve();
  function showErr(msg) { var b = $("#errBox"); b.textContent = msg; b.hidden = !msg; }
  var noteTimer = null;
  function note(msg) {
    var m = $("#noteBox");
    m.textContent = msg; m.hidden = !msg;
    if (noteTimer) clearTimeout(noteTimer);
    if (msg) noteTimer = setTimeout(function () { m.hidden = true; }, 7000);
  }
  function persist() {
    if (locked) return;
    var snap = clone(data);
    chain = chain.then(function () { return window.ledger.save(snap); }).then(function () { showErr(""); }).catch(function () {
      showErr("Could not save to this computer. Check that the disk is not full, then try again.");
    });
  }
  function upsert(col, obj) {
    var arr = data[col];
    var i = arr.findIndex(function (x) { return x.id === obj.id; });
    if (i >= 0) arr[i] = obj; else arr.push(obj);
    persist();
  }
  function removeFrom(col, id) { data[col] = data[col].filter(function (x) { return x.id !== id; }); persist(); }

  /* ---------- tabs and banner ---------- */
  function renderTabs() {
    var n = billAlerts().length;
    $("#tabs").innerHTML = TABS.map(function (t) {
      return '<button type="button" class="tab" role="tab" data-tab="' + t[0] + '" aria-selected="' + (ui.tab === t[0]) + '">' + esc(t[1]) +
        (t[0] === "overview" && n ? '<span class="badge">' + n + "</span>" : "") + "</button>";
    }).join("");
  }
  function renderBar() {
    var a = billAlerts(), bar = $("#alertBar");
    if (!a.length || ui.tab === "overview") { bar.hidden = true; return; }
    var late = a.filter(function (x) { return x.age >= LATE_DAYS; }).length;
    bar.hidden = false;
    bar.className = "alert-bar" + (late ? " late" : "");
    bar.textContent = plural(a.length, "finished job is", "finished jobs are") + " not billed yet and close to a month late" + (late ? " (" + late + " already past a month)" : "") + ". Click to see them.";
  }
  function renderLists() {
    $("#clientNames").innerHTML = data.clients.map(function (c) { return '<option value="' + esc(c.name) + '"></option>'; }).join("");
    $("#serviceNames").innerHTML = data.services.map(function (s) {
      return (s.code ? '<option value="' + esc(s.code) + '" label="' + esc(s.name) + '"></option>' : "") +
        '<option value="' + esc(s.name) + '" label="' + esc(money(s.rate) + " " + unitLabel(s.unit)) + '"></option>';
    }).join("");
  }
  function render() {
    rebuildIndex();
    renderTabs(); renderBar(); renderLists();
    var v = $("#view");
    if (!ready) { v.innerHTML = '<div class="empty"><h2>Loading</h2><p>Opening your saved jobs.</p></div>'; return; }
    ({ overview: vOverview, jobs: vJobs, clients: vClients, invoices: vInvoices, services: vServices, settings: vSettings })[ui.tab](v);
  }
  function go(tab) {
    ui.tab = tab; ui.form = null; ui.confirm = null; ui.batch = false;
    render(); window.scrollTo(0, 0);
  }

  /* ---------- Overview ---------- */
  function computeStats() {
    var s = { owed: 0, overdue: 0, overdueN: 0, toBill: 0, toBillN: 0, open: 0 };
    data.jobs.forEach(function (j) {
      s.owed += balance(j);
      if (isOverdue(j)) { s.overdue += balance(j); s.overdueN++; }
      if (j.jobStatus === "done" && j.billStatus === "unbilled") { s.toBill += jobTotal(j); s.toBillN++; }
      if (j.jobStatus !== "done") s.open++;
    });
    return s;
  }
  function statsHtml() {
    var s = computeStats();
    return '<section class="stats">' +
      '<div class="stat"><span>Owed to you</span><strong>' + money(s.owed) + "</strong><small>Billed, not yet paid</small></div>" +
      '<div class="stat' + (s.overdueN ? " alert" : "") + '"><span>Payments overdue</span><strong>' + money(s.overdue) + "</strong><small>" + plural(s.overdueN, "job", "jobs") + " past due</small></div>" +
      '<div class="stat"><span>Ready to bill</span><strong>' + money(s.toBill) + "</strong><small>" + plural(s.toBillN, "finished job", "finished jobs") + " not billed</small></div>" +
      '<div class="stat"><span>Open jobs</span><strong>' + s.open + "</strong><small>Not marked done</small></div></section>";
  }
  function miniRow(j, side, actions) {
    return '<div class="mini" data-id="' + esc(j.id) + '"><div class="mini-main"><strong>' + esc(cname(j)) + '</strong><span class="muted">' + esc(summary(j)) +
      '</span></div><div class="mini-side">' + side + '</div><div class="mini-act">' + actions + "</div></div>";
  }
  function vOverview(v) {
    var waiting = waitingJobs();
    var h = statsHtml();
    h += '<section class="panel"><div class="panel-head"><h2>Finished, waiting to be billed</h2><span class="muted">Reminders start after ' + warnDays() + " days. A month is " + LATE_DAYS + " days.</span></div>";
    if (!waiting.length) h += '<p class="empty-note">Every finished job has been billed.</p>';
    else h += waiting.map(function (w) {
      var l = ageLabel(w.age);
      return miniRow(w.job, "<strong>" + money(jobTotal(w.job)) + '</strong><span class="pill ' + l[1] + '">' + esc(l[0]) + "</span>",
        '<button type="button" class="btn small" data-act="invoice">View invoice</button><button type="button" class="btn small primary" data-act="billed">Mark billed</button>');
    }).join("");
    h += "</section>";

    var t = today(), end = addDays(t, 7);
    var upcoming = data.jobs.filter(function (j) { return j.jobStatus !== "done" && j.scheduled && j.scheduled <= end; })
      .sort(function (a, b) { return a.scheduled.localeCompare(b.scheduled); });
    h += '<section class="panel"><div class="panel-head"><h2>Coming up this week</h2></div>';
    if (!upcoming.length) h += '<p class="empty-note">Nothing scheduled in the next 7 days.</p>';
    else h += upcoming.map(function (j) {
      var late = j.scheduled < t;
      return miniRow(j, '<span class="pill ' + (late ? "bad" : "info") + '">' + (late ? "Past due date " : "") + esc(fmtDate(j.scheduled)) + "</span>" + (j.type ? '<span class="muted">' + esc(lookup(TYPES, j.type)) + "</span>" : ""),
        '<button type="button" class="btn small primary" data-act="done">Mark done</button>');
    }).join("");
    h += "</section>";

    var late = data.jobs.filter(isOverdue).sort(function (a, b) { return a.dueDate.localeCompare(b.dueDate); });
    h += '<section class="panel"><div class="panel-head"><h2>Payments overdue</h2></div>';
    if (!late.length) h += '<p class="empty-note">No payments are past due.</p>';
    else h += late.map(function (j) {
      return miniRow(j, "<strong>" + money(balance(j)) + '</strong><span class="pill bad">Due ' + esc(fmtDate(j.dueDate)) + "</span>",
        '<button type="button" class="btn small" data-act="invoice">View invoice</button><button type="button" class="btn small primary" data-act="paid">Mark paid</button>');
    }).join("");
    h += "</section>";
    if (!data.jobs.length) h = '<div class="empty"><h2>Welcome to Yard Ledger</h2><p>Start on the Services tab with your prices, add your clients, then create jobs. Finished jobs that are not billed show up here before they get a month late.</p><button type="button" class="btn primary" data-tab="services">Set up services</button></div>';
    v.innerHTML = h;
  }

  /* ---------- Jobs ---------- */
  function jobMatches(j, f) {
    if (f === "all") return true;
    if (f === "todo") return j.jobStatus !== "done";
    if (f === "tobill") return j.jobStatus === "done" && j.billStatus === "unbilled";
    if (f === "unpaid") return isOwed(j);
    if (f === "overdue") return isOverdue(j);
    if (f === "done") return j.jobStatus === "done" && j.billStatus === "paid";
    return true;
  }
  function visibleJobs() {
    var q = ui.jq.trim().toLowerCase();
    var out = data.jobs.filter(function (j) {
      if (ui.jobType !== "all" && j.type !== ui.jobType) return false;
      if (!jobMatches(j, ui.jobFilter)) return false;
      if (!q) return true;
      var hay = [cname(j), j.address, summary(j), j.notes].join(" ").toLowerCase();
      return hay.indexOf(q) !== -1;
    });
    out.sort(function (a, b) {
      if (ui.sort === "client") return cname(a).localeCompare(cname(b));
      if (ui.sort === "amount") return jobTotal(b) - jobTotal(a);
      if (ui.sort === "scheduled") return (a.scheduled || "9999").localeCompare(b.scheduled || "9999");
      if (ui.sort === "due") return (isOwed(a) && a.dueDate ? a.dueDate : "9999").localeCompare(isOwed(b) && b.dueDate ? b.dueDate : "9999");
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return out;
  }
  function nextAction(j) {
    if (j.jobStatus !== "done") return { act: "done", text: "Mark done" };
    if (j.billStatus === "unbilled") return { act: "billed", text: "Mark billed" };
    if (isOwed(j)) return { act: "paid", text: "Mark paid" };
    return null;
  }
  function opts(list, cur) {
    return list.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === cur ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("");
  }
  function lineRight(i) {
    var q = Number(i.qty) || 0;
    return qtyFmt(q) + (UNIT_SHORT[i.unit] || "") + " × " + money(Number(i.rate) || 0);
  }
  function jobCard(j) {
    var od = isOverdue(j), total = jobTotal(j);
    var bal = j.billStatus === "paid" ? "Paid in full" : j.billStatus === "unbilled" ? "Not billed yet" : "Balance " + money(balance(j));
    var meta = [];
    if (j.scheduled) meta.push("Scheduled " + esc(fmtDate(j.scheduled)));
    if (j.jobStatus === "done" && j.completedDate) meta.push("Done " + esc(fmtDate(j.completedDate)));
    if (isOwed(j) && j.dueDate) meta.push("Due " + esc(fmtDate(j.dueDate)));
    var wait = "";
    if (j.jobStatus === "done" && j.billStatus === "unbilled") { var l = ageLabel(ageDays(j)); if (l[1] !== "muted") wait = '<span class="pill ' + l[1] + '">' + esc(l[0]) + "</span>"; }
    var na = nextAction(j);
    var del = ui.confirm === "job:" + j.id
      ? '<button type="button" class="btn small danger" data-act="delJob">Confirm delete</button>'
      : '<button type="button" class="btn small" data-act="delJob">Delete</button>';
    var lines = "";
    if (hasItems(j)) lines = '<ul class="lines">' + j.items.map(function (i) { return "<li><span>" + esc(i.name) + "</span><span>" + esc(lineRight(i)) + "</span></li>"; }).join("") + "</ul>";
    else if (j.description) lines = '<p class="notes">' + esc(j.description) + "</p>";
    return '<article class="card' + (od ? " overdue" : "") + '" data-id="' + esc(j.id) + '">' +
      '<div class="card-top"><div class="who"><h3>' + esc(cname(j)) + "</h3>" + (j.address ? '<p class="sub">' + esc(j.address) + "</p>" : "") +
      '</div><div class="amt"><strong>' + money(total) + "</strong><span>" + esc(bal) + "</span></div></div>" + lines +
      (j.notes ? '<p class="notes">' + esc(j.notes) + "</p>" : "") +
      '<div class="meta">' + (j.type ? '<span class="pill type">' + esc(lookup(TYPES, j.type)) + "</span>" : "") +
      '<span class="pill ' + JOB_TONE[j.jobStatus] + '">' + esc(lookup(JOB, j.jobStatus)) + "</span>" +
      '<span class="pill ' + (od ? "bad" : BILL_TONE[j.billStatus]) + '">' + esc(od ? "Overdue" : lookup(BILL, j.billStatus)) + "</span>" + wait +
      (meta.length ? "<span>" + meta.join(" · ") + "</span>" : "") + "</div>" +
      '<div class="controls stack"><div class="ctl-row"><label>Job<select data-field="jobStatus" aria-label="Job status for ' + esc(cname(j)) + '">' + opts(JOB, j.jobStatus) + "</select></label>" +
      '<label>Payment<select data-field="billStatus" aria-label="Payment status for ' + esc(cname(j)) + '">' + opts(BILL, j.billStatus) + "</select></label>" +
      (na ? '<button type="button" class="btn primary" data-act="' + na.act + '">' + na.text + "</button>" : "") + "</div>" +
      '<div class="ctl-row end"><button type="button" class="btn small" data-act="invoice">Invoice</button>' +
      '<button type="button" class="btn small" data-act="repeat">Repeat</button>' +
      '<button type="button" class="btn small" data-act="editJob">Edit</button>' + del + "</div></div></article>";
  }
  function vJobs(v) {
    v.innerHTML =
      '<div class="tools"><button type="button" class="btn primary" data-act="newJob">New job</button>' +
      '<input type="search" id="jobSearch" placeholder="Search client, address or service" aria-label="Search jobs" value="' + esc(ui.jq) + '">' +
      '<select id="jobTypeSel" aria-label="Job type"><option value="all">All job types</option>' + opts(TYPES, ui.jobType) + "</select>" +
      '<select id="jobSort" aria-label="Sort jobs">' + opts([["newest", "Newest first"], ["scheduled", "Scheduled date"], ["due", "Payment due date"], ["client", "Client A to Z"], ["amount", "Largest amount"]], ui.sort) + "</select></div>" +
      '<div class="chips" id="jobChips"></div><div id="formWrap"></div><section class="list two" id="jobList"></section>';
    $("#jobTypeSel").value = ui.jobType;
    fillJobChips(); fillJobList();
  }
  function fillJobChips() {
    $("#jobChips").innerHTML = FILTERS.map(function (f) {
      var n = data.jobs.filter(function (j) { return jobMatches(j, f[0]); }).length;
      return '<button type="button" class="chip" data-filter="' + f[0] + '" aria-pressed="' + (ui.jobFilter === f[0]) + '">' + esc(f[1]) + "<em>" + n + "</em></button>";
    }).join("");
  }
  function fillJobList() {
    var el = $("#jobList"), rows = visibleJobs();
    if (!data.jobs.length) el.innerHTML = '<div class="empty"><h2>No jobs yet</h2><p>Add a job with the client, the services done and the date. Update it as you finish the work, bill it and get paid.</p><button type="button" class="btn primary" data-act="newJob">Add your first job</button></div>';
    else if (!rows.length) el.innerHTML = '<div class="empty"><h2>Nothing matches</h2><p>Try a different filter or clear the search box.</p></div>';
    else {
      el.innerHTML = rows.slice(0, ui.jobLimit).map(jobCard).join("") +
        (rows.length > ui.jobLimit ? '<div class="more"><button type="button" class="btn" data-act="moreJobs">Show more (' + (rows.length - ui.jobLimit) + " left)</button></div>" : "");
    }
  }

  /* job form */
  function itemRow(it) {
    it = it || {};
    return '<div class="item-row" data-unit="' + esc(it.unit || "") + '" data-sid="' + esc(it.serviceId || "") + '">' +
      '<input class="it-name" type="text" list="serviceNames" placeholder="Service or shortcut, e.g. CG" value="' + esc(it.name || "") + '" aria-label="Service">' +
      '<input class="it-qty" type="number" min="0" step="0.01" value="' + (it.qty === undefined || it.qty === "" ? "" : esc(it.qty)) + '" aria-label="Quantity">' +
      '<div class="price-cell"><input class="it-rate" type="number" min="0" step="0.01" value="' + (it.rate === undefined || it.rate === "" ? "" : esc(it.rate)) + '" aria-label="Price"><span class="it-unit">' + esc(unitLabel(it.unit)) + "</span></div>" +
      '<span class="it-total"></span><button type="button" class="btn small" data-act="rmItem">Remove</button></div>';
  }
  function jobFormHtml(id, prefill) {
    var j = id ? (jobById(id) || {}) : (prefill || {});
    var items = hasItems(j) ? j.items : null, notes = j.notes || "";
    if (!items) {
      if (j.amount) items = [{ name: j.description || "Job", qty: 1, rate: j.amount, unit: "flat" }];
      else { items = [{}]; if (j.description) notes = [j.description, notes].filter(Boolean).join("\n"); }
    }
    var name = id ? cname(j) : (j.clientName || "");
    return '<form class="form" id="jobForm" data-id="' + esc(id || "") + '"><h2>' + (id ? "Edit job" : "New job") + "</h2>" +
      '<div class="grid"><label>Client<input type="text" id="jf-client" list="clientNames" required maxlength="120" value="' + esc(name) + '" placeholder="Pick or type a name"></label>' +
      '<label>Job type<select id="jf-type">' + opts(TYPES, j.type || "lawn") + "</select></label>" +
      '<label>Scheduled date<input type="date" id="jf-scheduled" value="' + esc(j.scheduled || "") + '"></label>' +
      '<label>Job address<input type="text" id="jf-address" maxlength="200" value="' + esc(j.address || "") + '"></label></div>' +
      '<div class="checks" id="jf-hintwrap" hidden><label><input type="checkbox" id="jf-addClient" checked> This client is not in your list yet. Add them to the client list.</label></div>' +
      '<div class="field"><span>Services</span><div class="items-head"><span>Service</span><span>Qty</span><span>Price</span><span>Amount</span><span></span></div>' +
      '<div id="jf-items">' + items.map(itemRow).join("") + "</div></div>" +
      '<div class="actions"><button type="button" class="btn small" data-act="addItem">Add another service</button></div>' +
      '<div class="total-line"><span>Total</span><strong id="jf-total">$0.00</strong></div>' +
      '<label>Notes<textarea id="jf-notes" maxlength="600" placeholder="Gate code, materials, anything to remember">' + esc(notes) + "</textarea></label>" +
      '<div class="grid"><label>Job status<select id="jf-jobStatus">' + opts(JOB, j.jobStatus || "todo") + "</select></label>" +
      '<label>Payment status<select id="jf-billStatus">' + opts(BILL, j.billStatus || "unbilled") + "</select></label>" +
      '<label>Payment due<input type="date" id="jf-dueDate" value="' + esc(j.dueDate || "") + '"></label>' +
      '<label id="jf-paidWrap">Paid so far ($)<input type="number" id="jf-amountPaid" min="0" step="0.01" value="' + esc(j.amountPaid || "") + '"></label></div>' +
      '<div class="actions"><button type="submit" class="btn primary">Save job</button><button type="button" class="btn" data-act="closeForm">Cancel</button></div></form>';
  }
  function updateTotals() {
    var total = 0;
    $$("#jf-items .item-row").forEach(function (r) {
      var line = r2((num($(".it-qty", r).value, 0)) * (num($(".it-rate", r).value, 0)));
      total += line;
      $(".it-total", r).textContent = line ? money(line) : "";
    });
    var t = $("#jf-total"); if (t) t.textContent = money(r2(total));
  }
  function refreshClientHint() {
    var n = $("#jf-client").value.trim();
    $("#jf-hintwrap").hidden = !(n && !clientByName(n));
  }
  function syncPaid() { $("#jf-paidWrap").hidden = $("#jf-billStatus").value !== "partial"; }
  function onClientChosen() {
    var c = clientByName($("#jf-client").value);
    if (c) {
      if (!$("#jf-address").value.trim() && c.address) $("#jf-address").value = c.address;
      $$("#jf-items .item-row").forEach(function (r) {
        if (r.dataset.unit === "yard" && r.dataset.qtyauto === "1") $(".it-qty", r).value = num(c.yardage, 0) || 1;
      });
      updateTotals();
    }
    refreshClientHint();
  }
  function applyService(row) {
    var s = serviceByName($(".it-name", row).value);
    if (!s) { row.dataset.sid = ""; return; }
    var c = clientByName($("#jf-client").value);
    $(".it-name", row).value = s.name;
    row.dataset.sid = s.id; row.dataset.unit = s.unit;
    $(".it-rate", row).value = s.rate;
    $(".it-unit", row).textContent = unitLabel(s.unit);
    if (s.unit === "yard") { $(".it-qty", row).value = (c && num(c.yardage, 0)) || 1; row.dataset.qtyauto = "1"; }
    else if (!$(".it-qty", row).value) $(".it-qty", row).value = 1;
    if ($$("#jf-items .item-row")[0] === row && s.type) $("#jf-type").value = s.type;
    updateTotals();
  }
  function collectItems() {
    return $$("#jf-items .item-row").map(function (r) {
      return { name: $(".it-name", r).value.trim(), qty: num($(".it-qty", r).value, 0), rate: num($(".it-rate", r).value, 0), unit: r.dataset.unit || "", serviceId: r.dataset.sid || "" };
    }).filter(function (i) { return i.name || i.qty || i.rate; }).map(function (i) { if (!i.name) i.name = "Item"; return i; });
  }
  function billPatch(j, v) {
    var p = { billStatus: v };
    if (v === "paid") p.amountPaid = jobTotal(j);
    if (v === "unbilled" || v === "invoiced") p.amountPaid = 0;
    if ((v === "invoiced" || v === "partial") && !j.dueDate) p.dueDate = addDays(today(), num(st("dueDays"), 14));
    return p;
  }
  function submitJob(form) {
    var name = $("#jf-client").value.trim();
    if (!name) return;
    var id = form.dataset.id || uid("j"), existing = jobById(id) || {};
    var items = collectItems(), total = r2(items.reduce(function (s, i) { return s + i.qty * i.rate; }, 0));
    var client = clientByName(name);
    if (!client && $("#jf-addClient").checked) {
      client = { id: uid("c"), name: name, phone: "", email: "", address: $("#jf-address").value.trim(), yardage: 0, lists: {}, notes: "", createdAt: Date.now() };
      data.clients.push(client);
    }
    var jobStatus = $("#jf-jobStatus").value, bill = $("#jf-billStatus").value;
    var paid = num($("#jf-amountPaid").value, 0);
    if (bill === "paid") paid = total;
    if (bill === "unbilled" || bill === "invoiced") paid = 0;
    var due = $("#jf-dueDate").value;
    if ((bill === "invoiced" || bill === "partial") && !due) due = addDays(today(), num(st("dueDays"), 14));
    var job = {
      id: id, clientId: client ? client.id : "", clientName: name, type: $("#jf-type").value, address: $("#jf-address").value.trim(),
      scheduled: $("#jf-scheduled").value, items: items, amount: total, jobStatus: jobStatus, billStatus: bill, dueDate: due, amountPaid: paid,
      notes: $("#jf-notes").value.trim(), completedDate: jobStatus === "done" ? (existing.completedDate || today()) : "",
      createdAt: existing.createdAt || Date.now(), updatedAt: Date.now()
    };
    upsert("jobs", job);
    ui.form = null; render();
  }
  function patchJob(id, patch) {
    var j = jobById(id); if (!j) return;
    Object.assign(j, patch, { updatedAt: Date.now() });
    persist(); render();
  }
  function setJobStatus(id, v) {
    var j = jobById(id); if (!j) return;
    patchJob(id, { jobStatus: v, completedDate: v === "done" ? (j.completedDate || today()) : "" });
  }

  /* ---------- Clients ---------- */
  function clientMatches(c, f) { return f === "all" ? true : !!(c.lists && c.lists[f]); }
  function visibleClients() {
    var q = ui.cq.trim().toLowerCase();
    return data.clients.filter(function (c) {
      if (!clientMatches(c, ui.cFilter)) return false;
      if (!q) return true;
      return [c.name, c.phone, c.email, c.address, c.notes].join(" ").toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  }
  function clientCard(c) {
    var jobs = data.jobs.filter(function (j) { return j.clientId === c.id; });
    var owed = jobs.reduce(function (s, j) { return s + balance(j); }, 0);
    var lists = SEASONS.filter(function (s) { return c.lists && c.lists[s[0]]; }).map(function (s) { return '<span class="pill type">' + esc(s[1]) + "</span>"; }).join("");
    var invN = data.invoices.filter(function (i) { return i.clientId === c.id && !i.voided; }).length;
    var contact = [c.phone, c.email].filter(Boolean).join(" · ");
    var del = ui.confirm === "client:" + c.id
      ? '<button type="button" class="btn small danger" data-act="delClient">Confirm delete</button>'
      : '<button type="button" class="btn small" data-act="delClient">Delete</button>';
    return '<article class="card" data-id="' + esc(c.id) + '"><div class="card-top"><div class="who"><h3>' + esc(c.name) + "</h3>" +
      (contact ? '<p class="sub">' + esc(contact) + "</p>" : "") + (c.address ? '<p class="sub">' + esc(c.address) + "</p>" : "") +
      '</div><div class="amt"><strong>' + (num(c.yardage, 0) ? esc(qtyFmt(num(c.yardage, 0))) + " yd" : "No yardage") + "</strong><span>" + (owed ? "Owes " + money(owed) : plural(jobs.length, "job", "jobs")) + "</span></div></div>" +
      (lists ? '<div class="meta">' + lists + "</div>" : "") + (c.notes ? '<p class="notes">' + esc(c.notes) + "</p>" : "") +
      '<div class="controls"><span class="spacer"></span>' + (invN ? '<button type="button" class="btn small" data-act="clientInv">Invoices (' + invN + ")</button>" : "") + '<button type="button" class="btn small primary" data-act="jobFor">New job</button>' +
      '<button type="button" class="btn small" data-act="editClient">Edit</button>' + del + "</div></article>";
  }
  function vClients(v) {
    v.innerHTML =
      '<div class="tools"><button type="button" class="btn primary" data-act="newClient">New client</button>' +
      '<input type="search" id="clientSearch" placeholder="Search name, phone, address" aria-label="Search clients" value="' + esc(ui.cq) + '">' +
      '<span class="muted">' + plural(data.clients.length, "client", "clients") + "</span></div>" +
      '<div class="chips" id="clientChips"></div><div id="formWrap"></div><div id="batchWrap"></div><section class="list two" id="clientList"></section>';
    fillClientChips(); fillBatch(); fillClientList();
  }
  function fillClientChips() {
    var all = [["all", "All clients"]].concat(SEASONS);
    $("#clientChips").innerHTML = all.map(function (f) {
      var n = data.clients.filter(function (c) { return clientMatches(c, f[0]); }).length;
      return '<button type="button" class="chip" data-cfilter="' + f[0] + '" aria-pressed="' + (ui.cFilter === f[0]) + '">' + esc(f[1]) + "<em>" + n + "</em></button>";
    }).join("");
  }
  function fillClientList() {
    var el = $("#clientList"), rows = visibleClients();
    if (!data.clients.length) el.innerHTML = '<div class="empty"><h2>No clients yet</h2><p>Add each client once with their contact info, yardage and which seasonal lists they are on. You can pick them when you create a job.</p><button type="button" class="btn primary" data-act="newClient">Add your first client</button></div>';
    else if (!rows.length) el.innerHTML = '<div class="empty"><h2>Nothing matches</h2><p>Try a different list or clear the search box.</p></div>';
    else {
      el.innerHTML = rows.slice(0, ui.clientLimit).map(clientCard).join("") +
        (rows.length > ui.clientLimit ? '<div class="more"><button type="button" class="btn" data-act="moreClients">Show more (' + (rows.length - ui.clientLimit) + " left)</button></div>" : "");
    }
  }
  function fillBatch() {
    var w = $("#batchWrap"); if (!w) return;
    var season = ui.cFilter;
    if (season === "all") { w.innerHTML = ""; ui.batch = false; return; }
    var label = lookup(SEASONS, season), list = data.clients.filter(function (c) { return clientMatches(c, season); });
    if (!ui.batch) {
      w.innerHTML = '<div class="tools"><button type="button" class="btn" data-act="openBatch"' + (list.length ? "" : " disabled") + ">Create jobs for the " + esc(label) + " list</button><span class=\"muted\">One job for each of the " + plural(list.length, "client", "clients") + " on this list.</span></div>";
      return;
    }
    if (!data.services.length) { w.innerHTML = '<div class="panel"><h2>Create jobs for the ' + esc(label) + ' list</h2><p class="empty-note">Add at least one service on the Services tab first.</p><div class="actions"><button type="button" class="btn" data-act="closeBatch">Close</button></div></div>'; return; }
    w.innerHTML = '<form class="form" id="batchForm"><h2>Create a job for each client on the ' + esc(label) + ' list</h2>' +
      '<p class="hint">' + plural(list.length, "client", "clients") + ". Services priced per yard use each client's yardage.</p>" +
      '<div class="checks">' + data.services.map(function (s) {
        return '<label><input type="checkbox" name="bs" value="' + esc(s.id) + '"> ' + esc(s.name) + ' <span class="muted">' + esc(money(s.rate) + " " + unitLabel(s.unit)) + "</span></label>";
      }).join("") + "</div>" +
      '<label>Scheduled date (optional)<input type="date" id="bt-date"></label>' +
      '<div class="actions"><button type="submit" class="btn primary">Create jobs</button><button type="button" class="btn" data-act="closeBatch">Cancel</button></div></form>';
  }
  function runBatch(form) {
    var season = ui.cFilter, label = lookup(SEASONS, season);
    var list = data.clients.filter(function (c) { return clientMatches(c, season); });
    var chosen = $$("input[name=bs]:checked", form).map(function (i) { return data.services.filter(function (s) { return s.id === i.value; })[0]; }).filter(Boolean);
    if (!chosen.length || !list.length) { note("Pick at least one service."); return; }
    var date = $("#bt-date").value;
    list.forEach(function (c) {
      var items = chosen.map(function (s) {
        return { name: s.name, unit: s.unit, rate: s.rate, serviceId: s.id, qty: s.unit === "yard" ? (num(c.yardage, 0) || 1) : 1 };
      });
      data.jobs.push({
        id: uid("j"), clientId: c.id, clientName: c.name, type: chosen[0].type, address: c.address || "", scheduled: date, items: items,
        amount: r2(items.reduce(function (s, i) { return s + i.qty * i.rate; }, 0)), jobStatus: date ? "scheduled" : "todo", billStatus: "unbilled",
        dueDate: "", amountPaid: 0, notes: "From the " + label + " list", completedDate: "", createdAt: Date.now(), updatedAt: Date.now()
      });
    });
    persist();
    ui.batch = false; ui.tab = "jobs"; ui.jobFilter = "todo"; ui.form = null;
    render();
    note("Created " + plural(list.length, "job", "jobs") + " for the " + label + " list.");
  }
  function clientFormHtml(id) {
    var c = id ? (clientById(id) || {}) : {}, lists = c.lists || {};
    return '<form class="form" id="clientForm" data-id="' + esc(id || "") + '"><h2>' + (id ? "Edit client" : "New client") + "</h2>" +
      '<div class="grid"><label>Name<input type="text" id="cf-name" required maxlength="120" value="' + esc(c.name || "") + '"></label>' +
      '<label>Phone<input type="tel" id="cf-phone" maxlength="40" value="' + esc(c.phone || "") + '"></label>' +
      '<label>Email<input type="email" id="cf-email" maxlength="120" value="' + esc(c.email || "") + '"></label>' +
      '<label>Address<input type="text" id="cf-address" maxlength="200" value="' + esc(c.address || "") + '"></label>' +
      '<label>Yardage<input type="number" id="cf-yardage" min="0" step="0.01" value="' + esc(c.yardage || "") + '"></label></div>' +
      '<p class="hint">Yardage is used when a service is priced per yard.</p>' +
      '<div class="field"><span>On these lists</span><div class="checks">' + SEASONS.map(function (s) {
        return '<label><input type="checkbox" data-list="' + s[0] + '"' + (lists[s[0]] ? " checked" : "") + "> " + esc(s[1]) + "</label>";
      }).join("") + "</div></div>" +
      '<label>Notes<textarea id="cf-notes" maxlength="600">' + esc(c.notes || "") + "</textarea></label>" +
      '<div class="actions"><button type="submit" class="btn primary">Save client</button><button type="button" class="btn" data-act="closeForm">Cancel</button></div></form>';
  }
  function submitClient(form) {
    var name = $("#cf-name").value.trim(); if (!name) return;
    var id = form.dataset.id || uid("c"), ex = clientById(id) || {}, lists = {};
    $$("[data-list]", form).forEach(function (b) { lists[b.dataset.list] = b.checked; });
    upsert("clients", { id: id, name: name, phone: $("#cf-phone").value.trim(), email: $("#cf-email").value.trim(), address: $("#cf-address").value.trim(),
      yardage: num($("#cf-yardage").value, 0), lists: lists, notes: $("#cf-notes").value.trim(), createdAt: ex.createdAt || Date.now() });
    ui.form = null; render();
  }

  /* ---------- Services ---------- */
  function vServices(v) {
    v.innerHTML = '<div class="tools"><button type="button" class="btn primary" data-act="newService">New service</button>' +
      '<button type="button" class="btn" data-act="printList"' + (data.services.length ? "" : " disabled") + '>Print price list</button>' +
      '<span class="muted">Your price list. Prices are copied into a job when you add the service, so changing a price here does not change old jobs.</span></div>' +
      '<div id="formWrap"></div><section id="serviceList"></section>';
    var el = $("#serviceList");
    if (!data.services.length) { el.innerHTML = '<div class="empty"><h2>No services yet</h2><p>Add the work you do and what you charge, for example Cut grass at a price per yard. Then you can pick it on any job.</p><button type="button" class="btn primary" data-act="newService">Add your first service</button></div>'; return; }
    el.innerHTML = TYPES.map(function (t) {
      var list = data.services.filter(function (s) { return s.type === t[0]; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      if (!list.length) return "";
      return '<h3 class="group-title">' + esc(t[1]) + '</h3><div class="list two">' + list.map(function (s) {
        var del = ui.confirm === "service:" + s.id
          ? '<button type="button" class="btn small danger" data-act="delService">Confirm delete</button>'
          : '<button type="button" class="btn small" data-act="delService">Delete</button>';
        return '<article class="card" data-id="' + esc(s.id) + '"><div class="card-top"><div class="who"><h3>' + esc(s.name) + '</h3>' + (s.code ? '<p class="sub"><span class="pill type">' + esc(String(s.code).toUpperCase()) + "</span></p>" : "") + '</div><div class="amt"><strong>' + esc(money(s.rate)) + "</strong><span>" + esc(unitLabel(s.unit)) + "</span></div></div>" +
          '<div class="controls"><span class="spacer"></span><button type="button" class="btn small" data-act="editService">Edit</button>' + del + "</div></article>";
      }).join("") + "</div>";
    }).join("");
  }
  function serviceFormHtml(id) {
    var s = id ? (data.services.filter(function (x) { return x.id === id; })[0] || {}) : {};
    return '<form class="form" id="serviceForm" data-id="' + esc(id || "") + '"><h2>' + (id ? "Edit service" : "New service") + "</h2>" +
      '<div class="grid"><label>Service name (prints on the bill)<input type="text" id="sf-name" required maxlength="200" placeholder="Cut grass, trimmed, and cleaned up" value="' + esc(s.name || "") + '"></label>' +
      '<label>Shortcut (optional)<input type="text" id="sf-code" maxlength="12" placeholder="CG" value="' + esc(s.code || "") + '"></label>' +
      '<label>Job type<select id="sf-type">' + opts(TYPES, s.type || "lawn") + "</select></label>" +
      '<label>Priced<select id="sf-unit">' + opts(UNITS, s.unit || "yard") + "</select></label>" +
      '<label>Price ($)<input type="number" id="sf-rate" min="0" step="0.01" required value="' + esc(s.rate === undefined ? "" : s.rate) + '"></label></div>' +
      '<p class="hint">Per yard multiplies the price by the client\'s yardage. Flat price and each are charged once per job. Per hour uses the hours you enter on the job.</p>' +
      '<div class="actions"><button type="submit" class="btn primary">Save service</button><button type="button" class="btn" data-act="closeForm">Cancel</button></div></form>';
  }
  function submitService(form) {
    var name = $("#sf-name").value.trim(); if (!name) return;
    var id = form.dataset.id || uid("s");
    var code = $("#sf-code").value.trim().replace(/\s+/g, "");
    if (code && data.services.some(function (x) { return x.id !== id && String(x.code || "").toLowerCase() === code.toLowerCase(); })) { showErr("Another service already uses the shortcut " + code.toUpperCase() + ". Pick a different one."); return; }
    if (!locked) showErr("");
    upsert("services", { id: id, name: name, code: code.toUpperCase(), type: $("#sf-type").value, unit: $("#sf-unit").value, rate: num($("#sf-rate").value, 0) });
    ui.form = null; render();
  }

  /* ---------- Settings ---------- */
  function vSettings(v) {
    v.innerHTML = '<form class="form" id="settingsForm"><h2>Business and invoice</h2><p class="hint">These print on every invoice.</p>' +
      '<div class="grid"><label>Business name<input type="text" data-setting="businessName" value="' + esc(sv("businessName")) + '" maxlength="120"></label>' +
      '<label>Website<input type="text" data-setting="businessWebsite" value="' + esc(sv("businessWebsite")) + '" maxlength="120"></label>' +
      '<label>Facebook name<input type="text" data-setting="businessSocial" value="' + esc(sv("businessSocial")) + '" maxlength="80"></label>' +
      '<label>Address (one line per row)<textarea rows="2" data-setting="businessAddress" maxlength="200">' + esc(sv("businessAddress")) + '</textarea></label>' +
      '<label>Phone numbers (one per row)<textarea rows="2" data-setting="businessPhone" maxlength="120">' + esc(sv("businessPhone")) + '</textarea></label>' +
      '<label>Message at the bottom of invoices<textarea rows="2" data-setting="invoiceNote" maxlength="300">' + esc(st("invoiceNote")) + '</textarea></label>' +
      '<label>Next invoice number<input type="number" data-setting="nextInvoiceNo" min="1" step="1" value="' + esc(nextNo()) + '"></label>' +
      '<label>Payment due after (days)<input type="number" data-setting="dueDays" min="0" step="1" value="' + esc(st("dueDays")) + '"></label>' +
      '<label>Invoice logo (PNG or JPG)<input type="file" id="logoFile" accept="image/png,image/jpeg"></label></div>' +
      '<div class="actions"><button type="button" class="btn" data-act="resetLogo">Use the Lima\'s logo</button></div>' +
      "<h2>Reminders</h2>" +
      '<div class="grid"><label>Warn me when a finished job has not been billed after (days)<input type="number" data-setting="warnAfterDays" min="1" max="29" step="1" value="' + esc(st("warnAfterDays")) + '"></label></div>' +
      '<p class="hint">A job counts as a month late at ' + LATE_DAYS + ' days after it was marked done.</p>' +
      '<div class="setting-row"><label><input type="checkbox" data-setting="notify"' + (st("notify") ? " checked" : "") + '> Show a Windows notification once a day while Yard Ledger is open</label></div>' +
      '<div class="setting-row"><label><input type="checkbox" id="loginBox"> Start Yard Ledger when I sign in to Windows</label></div>' +
      '<div class="actions"><button type="button" class="btn" data-act="testNotify">Send a test notification</button></div>' +
      "<h2>Updates</h2>" +
      '<p class="hint">Yard Ledger ' + esc(appVersion || "") + '. When there is a new version, the app downloads and installs it by itself when it opens. It needs an internet connection for that. Everything else works offline.</p>' +
      '<div class="actions"><button type="button" class="btn" data-act="checkUpdate">Check for updates now</button><span class="muted" id="updStatus"></span></div>' +
      "<h2>Backup</h2>" +
      '<p class="hint">Your data is saved on this computer in %APPDATA%\\Yard Ledger. Keep a backup copy somewhere else, like a USB drive or OneDrive.</p>' +
      '<div class="actions"><button type="button" class="btn" data-act="backup">Save backup</button><button type="button" class="btn" data-act="restore">Restore backup</button></div></form>';
    window.ledger.getLogin().then(function (on) { var b = $("#loginBox"); if (b) b.checked = !!on; }).catch(function () {});
  }

  /* ---------- Invoice ---------- */
  function sv(k) { var v = st(k); return (v === undefined || v === null || String(v).trim() === "") ? DEFAULTS[k] : v; }
  function textLines(s) { return String(s || "").split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function addrLines(a) {
    var l = textLines(a);
    if (l.length === 1) { var i = l[0].indexOf(", "); if (i > 0) l = [l[0].slice(0, i), l[0].slice(i + 2)]; }
    return l;
  }
  function maxNo() { return data.invoices.reduce(function (m, i) { return Math.max(m, Number(i.no) || 0); }, 0); }
  function nextNo() { return Math.max(Math.floor(num(st("nextInvoiceNo"), 1001)), maxNo() + 1); }
  function invById(id) { return data.invoices.filter(function (i) { return i.id === id; })[0]; }
  function invoiceDate(j) { return j.completedDate || (j.jobStatus === "done" ? (j.scheduled || today()) : ""); }
  function draftFor(j) {
    var c = clientById(j.clientId) || {}, date = invoiceDate(j);
    var items = hasItems(j) ? j.items : [{ name: j.description || "Job", qty: 1, rate: Number(j.amount) || 0, unit: "flat" }];
    var lines = items.map(function (i) {
      var q = Number(i.qty) || 0, r = Number(i.rate) || 0;
      return { date: date, name: i.name, qty: q, unit: i.unit || "", rate: r, amount: r2(q * r) };
    });
    var total = r2(lines.reduce(function (s, l) { return s + l.amount; }, 0));
    var paid = j.billStatus === "paid" ? total : (j.billStatus === "partial" ? (Number(j.amountPaid) || 0) : 0);
    var mail = c.address || j.address || "";
    return { jobId: j.id, clientId: j.clientId || "", date: date, dueDate: j.dueDate || addDays(today(), num(st("dueDays"), 14)),
      billTo: { name: cname(j), address: mail, phone: c.phone || "", email: c.email || "" },
      site: j.address && j.address !== mail ? j.address : "", lines: lines, total: total, paid: paid, voided: false };
  }
  function openInvoice(jobId) {
    var j = jobById(jobId); if (!j) return;
    var inv = j.invoiceId && invById(j.invoiceId);
    ui.invoice = inv ? { invId: inv.id } : { jobId: jobId };
    renderInvoice();
  }
  function logoSrc() { return st("logoData") || "logo.png"; }
  function fbIcon() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#1D5FA8"/><path fill="#fff" d="M13.3 19.5v-6.6h2.2l.4-2.6h-2.6V8.7c0-.8.3-1.3 1.4-1.3h1.3V5.1c-.2 0-1-.1-1.9-.1-2 0-3.3 1.2-3.3 3.4v1.9H8.6v2.6h2.2v6.6z"/></svg>'; }
  function bizHeadHtml() {
    var biz = textLines(sv("businessAddress")).concat(textLines(sv("businessPhone"))).concat([sv("businessWebsite")]).map(function (l) { return "<span>" + esc(l) + "</span>"; }).join("");
    return '<div class="inv-head"><img class="inv-logo" src="' + esc(logoSrc()) + '" alt=""><div class="inv-biz"><b>' + esc(sv("businessName")) + "</b>" + biz + "</div></div>";
  }
  function bizFootHtml() {
    return '<div class="inv-foot"><span>' + esc(String(st("invoiceNote") || "").trim()) + '</span><div class="inv-social">' + fbIcon() + "<div><b>" + esc(sv("businessSocial")) + "</b>" + esc(sv("businessWebsite")) + "</div></div></div>";
  }
  function renderPriceList() {
    var layer = $("#invoiceLayer"), s = ui.invoice, codes = s.codes !== false;
    var body = TYPES.map(function (t) {
      var list = data.services.filter(function (x) { return x.type === t[0]; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      if (!list.length) return "";
      return '<tbody><tr class="grp"><td colspan="' + (codes ? 4 : 3) + '">' + esc(t[1]) + "</td></tr>" + list.map(function (x) {
        return "<tr>" + (codes ? '<td class="d">' + esc(String(x.code || "").toUpperCase()) + "</td>" : "") + "<td>" + esc(x.name) + '</td><td class="r">' + esc(unitLabel(x.unit)) + '</td><td class="r">' + esc(money(x.rate)) + "</td></tr>";
      }).join("") + "</tbody>";
    }).join("");
    layer.hidden = false;
    layer.innerHTML = '<div class="inv-bar no-print"><span class="inv-msg"></span><button type="button" class="btn" data-act="toggleCodes">' + (codes ? "Hide shortcuts" : "Show shortcuts") + '</button>' +
      '<button type="button" class="btn" data-act="closeInvoice">Close</button><button type="button" class="btn primary" data-act="printInvoice">Print</button></div>' +
      '<div class="inv-sheet">' + bizHeadHtml() + '<div class="inv-mid" style="height:auto;margin-top:0.35in"><div class="inv-to"></div><div class="inv-meta"><h1>PRICE LIST</h1><dl><dt>As of</dt><dd>' + esc(fmtDateLong(today())) + "</dd></dl></div></div>" +
      '<table class="inv-table"><thead><tr>' + (codes ? "<th>Shortcut</th>" : "") + '<th>Service</th><th class="r">Priced</th><th class="r">Price</th></tr></thead>' + body + "</table>" + bizFootHtml() + "</div>";
  }
  function renderInvoice() {
    var layer = $("#invoiceLayer"), s = ui.invoice, inv = null, draft = false;
    if (s && s.list) { renderPriceList(); return; }
    if (s && s.invId) inv = invById(s.invId);
    else if (s && s.jobId) { var jj = jobById(s.jobId); if (jj) { inv = draftFor(jj); draft = true; } }
    if (!inv) { ui.invoice = null; layer.hidden = true; layer.innerHTML = ""; return; }
    var b = inv.billTo || {}, due = inv.dueDate, bal = r2(inv.total - (inv.paid || 0));
    var addr = addrLines(b.address).map(function (l) { return "<span>" + esc(l) + "</span>"; }).join("");
    var rows = inv.lines.map(function (l) {
      return '<tr><td class="d">' + esc(l.date ? fmtDateLong(l.date) : "") + '</td><td class="q">' + esc(qtyFmt(l.qty) + (UNIT_SHORT[l.unit] || "")) + "</td><td>" + esc(l.name) + '</td><td class="r">' + esc(money(l.rate)) + '</td><td class="r">' + esc(money(l.amount)) + "</td></tr>";
    }).join("");
    var site = inv.site ? '<tr class="site"><td></td><td></td><td colspan="3">Service location: ' + esc(inv.site) + "</td></tr>" : "";
    var biz = textLines(sv("businessAddress")).concat(textLines(sv("businessPhone"))).concat([sv("businessWebsite")]).map(function (l) { return "<span>" + esc(l) + "</span>"; }).join("");
    var note = String(st("invoiceNote") || "").trim();
    var msg = s.msg ? s.msg : (draft ? (inv.date ? "Preview. Issuing gives it invoice No. " + nextNo() + " and saves a copy." : "Mark the job done first so the invoice can be dated.") : "");
    var bar = '<div class="inv-bar no-print"><span class="inv-msg">' + esc(msg) + '</span>' +
      '<button type="button" class="btn" data-act="closeInvoice">Close</button>' +
      (draft ? '<button type="button" class="btn primary" data-act="issueInvoice"' + (inv.date ? "" : " disabled") + ">Issue invoice</button>" :
        '<button type="button" class="btn" data-act="openInvFolder">Open folder</button><button type="button" class="btn" data-act="savePdf">Save PDF again</button>' +
        (inv.voided ? "" : '<button type="button" class="btn' + (s.confirmVoid ? " danger" : "") + '" data-act="voidInv">' + (s.confirmVoid ? "Confirm void" : "Void") + '</button><button type="button" class="btn primary" data-act="printInvoice">Print</button>')) + "</div>";
    layer.hidden = false;
    layer.innerHTML = bar + '<div class="inv-sheet">' +
      '<i class="inv-fold" style="top:3.667in"></i><i class="inv-fold" style="top:7.333in"></i>' + (inv.voided ? '<div class="inv-void">VOID</div>' : "") +
      '<div class="inv-head"><img class="inv-logo" src="' + esc(logoSrc()) + '" alt=""><div class="inv-biz"><b>' + esc(sv("businessName")) + "</b>" + biz + "</div></div>" +
      '<div class="inv-mid"><div class="inv-to"><small>Bill to</small><strong>' + esc(b.name || "") + "</strong>" + addr + "</div>" +
      '<div class="inv-meta"><h1>INVOICE</h1><dl><dt>Invoice no.</dt><dd>' + (draft ? "Draft" : esc(inv.no)) + "</dd><dt>Date</dt><dd>" + esc(inv.date ? fmtDateLong(inv.date) : "") + "</dd><dt>Due</dt><dd>" + esc(due ? fmtDateLong(due) : "") + "</dd></dl></div></div>" +
      '<table class="inv-table"><thead><tr><th>Date</th><th class="q">Qty</th><th>Description</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>' + rows + site + "</tbody></table>" +
      '<div class="inv-sum"><div><span>Total</span><span>' + esc(money(inv.total)) + "</span></div>" + (inv.paid ? "<div><span>Paid</span><span>-" + esc(money(inv.paid)) + "</span></div>" : "") +
      '<div class="grand"><span>Amount due</span><span>' + esc(money(bal)) + "</span></div></div>" +
      '<div class="inv-foot"><span>' + esc(note) + '</span><div class="inv-social">' + fbIcon() + "<div><b>" + esc(sv("businessSocial")) + "</b>" + esc(sv("businessWebsite")) + "</div></div></div></div>";
  }
  function closeInvoice() { ui.invoice = null; renderInvoice(); if (ready) render(); }
  function setInvMsg(m) { if (ui.invoice) { ui.invoice.msg = m; renderInvoice(); } }
  function savePdfFor(inv) {
    return window.ledger.savePdf({ client: (inv.billTo && inv.billTo.name) || inv.clientName, no: inv.no, date: inv.date }).then(function (r) {
      setInvMsg(r && r.ok ? "Saved a PDF copy to " + r.path : "Could not save the PDF copy. The invoice itself is saved in Yard Ledger.");
    }).catch(function () { setInvMsg("Could not save the PDF copy. The invoice itself is saved in Yard Ledger."); });
  }
  function issueInvoice() {
    var s = ui.invoice, j = s && s.jobId && jobById(s.jobId);
    if (!j || (j.invoiceId && invById(j.invoiceId))) return;
    var d = draftFor(j); if (!d.date) return;
    if (j.billStatus === "unbilled") Object.assign(j, billPatch(j, "invoiced"), { updatedAt: Date.now() });
    d.dueDate = j.dueDate || d.dueDate;
    var no = nextNo();
    d.id = uid("i"); d.no = no; d.createdAt = Date.now();
    data.invoices.push(d);
    j.invoiceId = d.id; j.invoiceNo = no; j.updatedAt = Date.now();
    data.settings.nextInvoiceNo = no + 1;
    persist();
    ui.invoice = { invId: d.id, msg: "Invoice " + no + " saved. Saving a PDF copy..." };
    render(); renderInvoice();
    setTimeout(function () { savePdfFor(d); }, 300);
  }
  function voidInvoice() {
    var s = ui.invoice, inv = s && s.invId && invById(s.invId); if (!inv) return;
    if (!s.confirmVoid) { s.confirmVoid = true; renderInvoice(); return; }
    inv.voided = true; inv.voidedAt = Date.now();
    var j = jobById(inv.jobId); if (j && j.invoiceId === inv.id) { j.invoiceId = ""; j.invoiceNo = ""; }
    persist(); ui.invoice = { invId: inv.id, msg: "Invoice " + inv.no + " is void. Its number will not be used again." };
    render(); renderInvoice();
  }

  /* ---------- Invoices tab ---------- */
  function invRows() {
    var q = ui.iq.trim().toLowerCase();
    return data.invoices.filter(function (i) {
      if (!q) return true;
      return [i.no, (i.billTo && i.billTo.name) || "", i.date, i.date ? fmtDateLong(i.date) : ""].join(" ").toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) { return (Number(b.no) || 0) - (Number(a.no) || 0); });
  }
  function invStatus(i) {
    if (i.voided) return '<span class="pill bad">Void</span>';
    var j = jobById(i.jobId); if (!j) return '<span class="pill muted">Saved</span>';
    if (j.billStatus === "paid") return '<span class="pill good">Paid</span>';
    if (j.billStatus === "partial") return '<span class="pill warn">Part paid</span>';
    return isOverdue(j) ? '<span class="pill bad">Overdue</span>' : '<span class="pill info">Unpaid</span>';
  }
  function vInvoices(v) {
    v.innerHTML = '<div class="tools"><input type="search" id="invSearch" placeholder="Search client, number or date" aria-label="Search invoices" value="' + esc(ui.iq) + '">' +
      '<button type="button" class="btn" data-act="openInvFolderAll">Open invoices folder</button><span class="muted">' + plural(data.invoices.length, "invoice", "invoices") + "</span></div>" +
      '<p class="hint muted">Issue an invoice from a finished job. Each one gets the next number, is dated the day the job was finished, and a PDF copy is saved in Documents\\Yard Ledger Invoices\\(client name).</p>' +
      '<section class="list" id="invList"></section>';
    fillInvList();
  }
  function fillInvList() {
    var el = $("#invList"); if (!el) return;
    var rows = invRows();
    if (!data.invoices.length) { el.innerHTML = '<div class="empty"><h2>No invoices yet</h2><p>Open a finished job on the Jobs tab and press Invoice, then Issue invoice.</p></div>'; return; }
    if (!rows.length) { el.innerHTML = '<div class="empty"><h2>Nothing matches</h2><p>Try a different search.</p></div>'; return; }
    var shown = rows.slice(0, ui.invLimit), html = "", year = "";
    shown.forEach(function (i) {
      var y = (i.date || dstr(new Date(i.createdAt || Date.now()))).slice(0, 4);
      if (y !== year) {
        year = y;
        var all = rows.filter(function (r) { return (r.date || dstr(new Date(r.createdAt || Date.now()))).slice(0, 4) === y && !r.voided; });
        html += '<div class="yhead"><span>' + esc(y) + '</span><span class="muted">' + plural(all.length, "invoice", "invoices") + " · " + esc(money(r2(all.reduce(function (s, r) { return s + r.total; }, 0)))) + "</span></div>";
      }
      html += '<div class="irow" data-id="' + esc(i.id) + '"><span class="num">#' + esc(i.no) + '</span><span class="dt">' + esc(i.date ? fmtDateLong(i.date) : "") + '</span><span class="nm">' + esc((i.billTo && i.billTo.name) || "") +
        '</span><span class="tot">' + esc(money(i.total)) + '</span><span class="st">' + invStatus(i) + '</span><span class="btns"><button type="button" class="btn small" data-act="viewInv">View</button></span></div>';
    });
    if (rows.length > ui.invLimit) html += '<div class="more"><button type="button" class="btn" data-act="moreInv">Show more (' + (rows.length - ui.invLimit) + " left)</button></div>";
    el.innerHTML = html;
  }

  /* ---------- updates ---------- */
  function updStatus(msg) { var el = $("#updStatus"); if (el) el.textContent = msg; }
  var autoTried = false;
  function installUpdateNow() {
    updStatus("Installing...");
    return chain.then(function () { return window.ledger.installUpdate(); }).then(function (r) {
      if (r && r.error) { showErr(r.error); updStatus(""); return false; }
      note("Installing the update. Yard Ledger will restart in a moment."); return true;
    }).catch(function () { showErr("Could not install the update."); return false; });
  }
  function checkUpdate(manual, auto) {
    return window.ledger.checkUpdate().then(function (r) {
      var box = $("#updBox");
      if (r && r.status === "available") {
        if (auto && !autoTried) { autoTried = true; box.hidden = false; box.innerHTML = "<span>Installing update " + esc(r.version) + ". Yard Ledger will restart in a moment.</span>"; installUpdateNow().then(function (ok) { if (!ok) checkUpdate(false); }); return; }
        box.hidden = false;
        box.innerHTML = "<span>Update " + esc(r.version) + " is ready (you have " + esc(r.current) + ")." + (r.notes ? " " + esc(r.notes) : "") + '</span><button type="button" class="btn small primary" data-act="installUpdate">Install and restart</button>';
        if (manual) updStatus("Update " + r.version + " found.");
      } else {
        box.hidden = true;
        if (manual) updStatus(r && r.status === "current" ? "You are up to date (" + r.current + ")." : "Could not reach the update server. Check the internet connection.");
      }
    }).catch(function () { if (manual) updStatus("Could not check for updates."); });
  }

  /* ---------- notifications ---------- */
  function checkReminders() {
    if (!ready || locked) return;
    var list = billAlerts();
    if (!list.length || st("notify") === false || data.settings.lastNotified === today()) return;
    var late = list.filter(function (a) { return a.age >= LATE_DAYS; }).length;
    var names = list.slice(0, 3).map(function (a) { return cname(a.job); }).join(", ") + (list.length > 3 ? " and more" : "");
    window.ledger.notify({
      title: plural(list.length, "bill", "bills") + " not sent yet",
      body: (late ? late + " already past a month. " : "Close to a month late. ") + names
    }).catch(function () {});
    data.settings.lastNotified = today();
    persist();
  }

  /* ---------- events ---------- */
  function showForm(kind, id, prefill) {
    ui.form = { kind: kind, id: id || null };
    var w = $("#formWrap"); if (!w) return;
    w.innerHTML = kind === "job" ? jobFormHtml(id, prefill) : kind === "client" ? clientFormHtml(id) : serviceFormHtml(id);
    if (kind === "job") { updateTotals(); refreshClientHint(); syncPaid(); }
    w.scrollIntoView({ block: "start", behavior: "smooth" });
    var first = $("input:not([type=hidden])", w); if (first) first.focus({ preventScroll: true });
  }
  function closeForm() { ui.form = null; var w = $("#formWrap"); if (w) w.innerHTML = ""; }
  function rowId(el) { var c = el.closest("[data-id]"); return c ? c.getAttribute("data-id") : null; }
  function clearConfirm() { if (ui.confirm) { ui.confirm = null; render(); } }
  function repeatPrefill(j) {
    return { clientName: cname(j), clientId: j.clientId, address: j.address, type: j.type, items: hasItems(j) ? clone(j.items) : null,
      description: hasItems(j) ? "" : j.description, amount: hasItems(j) ? 0 : j.amount, notes: j.notes };
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-tab],[data-act],[data-filter],[data-cfilter],#alertBar");
    if (!t) { if (ui.confirm) clearConfirm(); return; }
    if (t.id === "alertBar") { go("overview"); return; }
    if (t.dataset.tab) { go(t.dataset.tab); return; }
    if (t.dataset.filter) { ui.jobFilter = t.dataset.filter; ui.jobLimit = PAGE; fillJobChips(); fillJobList(); return; }
    if (t.dataset.cfilter) { ui.cFilter = t.dataset.cfilter; ui.clientLimit = PAGE; ui.batch = false; fillClientChips(); fillBatch(); fillClientList(); return; }
    var act = t.dataset.act, id = rowId(t), j = id ? jobById(id) : null;
    if (act !== "delJob" && act !== "delClient" && act !== "delService" && ui.confirm) { ui.confirm = null; }
    switch (act) {
      case "newJob": ui.form = null; if (ui.tab !== "jobs") go("jobs"); showForm("job", null, null); break;
      case "editJob": showForm("job", id, null); break;
      case "repeat": if (j) { showForm("job", null, repeatPrefill(j)); } break;
      case "jobFor": { var c = clientById(id); ui.tab = "jobs"; render(); showForm("job", null, c ? { clientName: c.name, clientId: c.id, address: c.address } : null); break; }
      case "newClient": showForm("client", null); break;
      case "editClient": showForm("client", id); break;
      case "newService": showForm("service", null); break;
      case "editService": showForm("service", id); break;
      case "closeForm": closeForm(); break;
      case "addItem": { var box = $("#jf-items"); if (box) { box.insertAdjacentHTML("beforeend", itemRow({})); var last = $$(".it-name", box).pop(); if (last) last.focus(); } break; }
      case "rmItem": { var row = t.closest(".item-row"); if (row && $$("#jf-items .item-row").length > 1) { row.remove(); } else if (row) { $$("input", row).forEach(function (i) { i.value = ""; }); row.dataset.unit = ""; row.dataset.sid = ""; $(".it-unit", row).textContent = ""; } updateTotals(); break; }
      case "done": if (j) setJobStatus(id, "done"); break;
      case "billed": if (j) patchJob(id, billPatch(j, "invoiced")); break;
      case "paid": if (j) patchJob(id, billPatch(j, "paid")); break;
      case "invoice": if (j) openInvoice(id); break;
      case "checkUpdate": updStatus("Checking..."); checkUpdate(true, false); break;
      case "installUpdate": t.disabled = true; installUpdateNow().then(function (ok) { if (!ok) t.disabled = false; }); break;
      case "printList": ui.invoice = { list: true, codes: true }; renderInvoice(); break;
      case "toggleCodes": if (ui.invoice) { ui.invoice.codes = ui.invoice.codes === false; renderInvoice(); } break;
      case "issueInvoice": issueInvoice(); break;
      case "voidInv": voidInvoice(); break;
      case "printInvoice": window.ledger.printInvoice().catch(function () {}); break;
      case "savePdf": { var si = ui.invoice && invById(ui.invoice.invId); if (si) savePdfFor(si); break; }
      case "openInvFolder": { var oi = ui.invoice && invById(ui.invoice.invId); window.ledger.openFolder(oi && oi.billTo ? oi.billTo.name : "").catch(function () {}); break; }
      case "openInvFolderAll": window.ledger.openFolder("").catch(function () {}); break;
      case "closeInvoice": closeInvoice(); break;
      case "viewInv": if (id && invById(id)) { ui.invoice = { invId: id }; renderInvoice(); } break;
      case "moreInv": ui.invLimit += PAGE; fillInvList(); break;
      case "clientInv": { var cc = clientById(id); ui.iq = cc ? cc.name : ""; ui.invLimit = PAGE; go("invoices"); break; }
      case "resetLogo": data.settings.logoData = ""; persist(); note("Using the Lima's logo."); break;
      case "delJob": case "delClient": case "delService": {
        var key = (act === "delJob" ? "job:" : act === "delClient" ? "client:" : "service:") + id;
        if (ui.confirm === key) { ui.confirm = null; removeFrom(act === "delJob" ? "jobs" : act === "delClient" ? "clients" : "services", id); render(); }
        else { ui.confirm = key; render(); }
        break;
      }
      case "moreJobs": ui.jobLimit += PAGE; fillJobList(); break;
      case "moreClients": ui.clientLimit += PAGE; fillClientList(); break;
      case "openBatch": ui.batch = true; fillBatch(); break;
      case "closeBatch": ui.batch = false; fillBatch(); break;
      case "testNotify": window.ledger.notify({ title: "Yard Ledger", body: "Reminders are working." }).then(function (ok) { if (!ok) note("Windows did not show the notification. Check that notifications are on for this app."); }); break;
      case "backup":
        window.ledger.exportData(clone(data)).then(function (r) {
          if (r && r.ok) note("Backup saved to " + r.path); else if (r && r.error) showErr("Could not save the backup file.");
        }).catch(function () { showErr("Could not save the backup file."); });
        break;
      case "restore":
        window.ledger.importData().then(function (r) {
          if (!r || r.canceled) return;
          if (r.error) { showErr(r.error); return; }
          ["jobs", "clients", "services", "invoices"].forEach(function (col) {
            var by = {}; data[col].forEach(function (x) { by[x.id] = x; }); (r.data[col] || []).forEach(function (x) { by[x.id] = x; });
            data[col] = Object.keys(by).map(function (k) { return by[k]; });
          });
          data.settings = Object.assign({}, r.data.settings, data.settings);
          persist(); render();
          note("Restored " + plural(r.data.jobs.length, "job", "jobs") + ", " + plural(r.data.clients.length, "client", "clients") + " and " + plural(r.data.services.length, "service", "services") + " from the backup.");
        }).catch(function () { showErr("Could not read that backup file."); });
        break;
    }
  });

  document.addEventListener("input", function (e) {
    var t = e.target;
    if (t.id === "jobSearch") { ui.jq = t.value; ui.jobLimit = PAGE; fillJobList(); }
    else if (t.id === "invSearch") { ui.iq = t.value; ui.invLimit = PAGE; fillInvList(); }
    else if (t.id === "clientSearch") { ui.cq = t.value; ui.clientLimit = PAGE; fillClientList(); }
    else if (t.id === "jf-client") refreshClientHint();
    else if (t.classList.contains("it-qty")) { var r = t.closest(".item-row"); if (r) r.dataset.qtyauto = ""; updateTotals(); }
    else if (t.classList.contains("it-rate")) updateTotals();
  });
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.id === "jobTypeSel") { ui.jobType = t.value; ui.jobLimit = PAGE; fillJobList(); }
    else if (t.id === "jobSort") { ui.sort = t.value; ui.jobLimit = PAGE; fillJobList(); }
    else if (t.id === "jf-client") onClientChosen();
    else if (t.classList.contains("it-name")) applyService(t.closest(".item-row"));
    else if (t.id === "jf-billStatus") {
      syncPaid();
      var v = t.value;
      if ((v === "invoiced" || v === "partial") && !$("#jf-dueDate").value) $("#jf-dueDate").value = addDays(today(), num(st("dueDays"), 14));
    }
    else if (t.dataset && t.dataset.field) {
      var id = rowId(t), j = id && jobById(id); if (!j) return;
      if (t.dataset.field === "jobStatus") setJobStatus(id, t.value);
      else { var p = billPatch(j, t.value); patchJob(id, p); if (t.value === "partial") showForm("job", id, null); }
    }
    else if (t.id === "logoFile") {
      var lf = t.files && t.files[0]; if (!lf) return;
      if (!/^image\/(png|jpeg)$/.test(lf.type) || lf.size > 2000000) { showErr("Pick a PNG or JPG logo under 2 MB."); t.value = ""; return; }
      var fr = new FileReader();
      fr.onload = function () { data.settings.logoData = String(fr.result); persist(); showErr(""); note("Logo updated. It shows on your next invoice."); };
      fr.onerror = function () { showErr("Could not read that image."); };
      fr.readAsDataURL(lf);
    }
    else if (t.dataset && t.dataset.setting) {
      var key = t.dataset.setting;
      data.settings[key] = t.type === "checkbox" ? t.checked : (t.type === "number" ? num(t.value, DEFAULTS[key]) : (t.tagName === "TEXTAREA" ? t.value.replace(/[ \t]+$/gm, "").trim() : t.value.trim()));
      if (key === "nextInvoiceNo") { data.settings[key] = Math.max(Math.floor(num(data.settings[key], 1001)), maxNo() + 1); t.value = data.settings[key]; }
      persist(); renderTabs(); renderBar();
    }
    else if (t.id === "loginBox") window.ledger.setLogin(t.checked).then(function (on) { t.checked = !!on; }).catch(function () {});
  });
  document.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target;
    if (f.id === "jobForm") submitJob(f);
    else if (f.id === "clientForm") submitClient(f);
    else if (f.id === "serviceForm") submitService(f);
    else if (f.id === "batchForm") runBatch(f);
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && ui.invoice) closeInvoice(); });

  /* ---------- start ---------- */
  function norm(d) {
    d = d || {};
    return { jobs: Array.isArray(d.jobs) ? d.jobs : [], clients: Array.isArray(d.clients) ? d.clients : [], services: Array.isArray(d.services) ? d.services : [], invoices: Array.isArray(d.invoices) ? d.invoices : [], settings: d.settings && typeof d.settings === "object" ? d.settings : {} };
  }
  render();
  window.ledger.load().then(function (d) {
    data = norm(d); ready = true; render(); checkReminders();
    try { window.ledger.version().then(function (v) { appVersion = v; if (ui.tab === "settings") render(); }).catch(function () {}); } catch (e) { /* version is only for display */ }
    setTimeout(function () { checkUpdate(false, true); }, 3000);
    setInterval(function () {
      renderTabs(); renderBar(); checkReminders(); checkUpdate(false);
      if (ui.tab === "overview" && !ui.form && !ui.invoice) render();
    }, 60 * 60 * 1000);
  }).catch(function () {
    locked = true; ready = true;
    showErr("Could not read your saved data. Nothing has been changed, and new changes will not be saved until this is fixed. Close the app and open it again, or restore a backup.");
    render();
  });
})();
