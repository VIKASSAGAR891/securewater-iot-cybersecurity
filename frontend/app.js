const state = {
    token: null,
    timer: null,
    monitorTimer: null,
    latestEventKey: null,
    monitorReady: false,
    monitorRequest: false
};

const $ = id => document.getElementById(id);

function headers(json = false) {
    const h = {};
    if (json) h["Content-Type"] = "application/json";
    if (state.token) h["Authorization"] = `Bearer ${state.token}`;
    return h;
}

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...headers(Boolean(options.body)),
            ...(options.headers || {})
        }
    });

    let data = {};
    try {
        data = await response.json();
    } catch (_) {}

    if (!response.ok) {
        const error = new Error(
            data.detail || `Request failed (${response.status})`
        );
        error.status = response.status;
        throw error;
    }

    return data;
}

function text(id, value) {
    const el = $(id);
    if (el) el.textContent = value ?? "—";
}

function monitorStyles() {
    if ($("monitor-styles")) return;
    const style = document.createElement("style");
    style.id = "monitor-styles";
    style.textContent = `.security-monitor{margin:18px 0}.monitor-grid{display:grid;grid-template-columns:1.25fr .75fr;gap:18px}.monitor-flow{display:grid;grid-template-columns:1fr 34px 1fr 34px 1fr 34px 1fr;align-items:center}.monitor-step{display:flex;flex-direction:column;gap:7px;padding:16px;background:#f7fafc;border:1px solid var(--line);border-radius:10px;min-height:100px}.monitor-step small,.alert-modal small{color:var(--muted);letter-spacing:.08em;font-weight:700;font-size:10px}.monitor-step b{font-size:15px;overflow-wrap:anywhere}.monitor-step span{color:var(--muted);font-size:12px}.monitor-step strong{color:var(--red);font-size:18px}.monitor-step.recorded{border-color:#b9d9c6}.flow-arrow{text-align:center;color:var(--blue);font-size:22px;font-weight:700}.monitor-empty{color:var(--muted);padding:10px 0}.event-list{display:grid;gap:8px;max-height:310px;overflow:auto}.event-list .event{border:1px solid #edf0f3;border-radius:8px;padding:11px 13px}.event-list .event b,.event-list .event p,.event-list .event small{display:block}.event-list .event p{margin:5px 0;color:var(--muted);font-size:13px}.event-list .event small{font-size:11px;color:var(--muted)}.activity-summary{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.activity-summary div{padding:15px;background:#f7fafc;border:1px solid #edf0f3;border-radius:8px}.activity-summary b,.activity-summary small{display:block}.activity-summary b{font-size:25px}.activity-summary small{margin-top:4px;color:var(--muted)}.alert-backdrop{position:fixed;inset:0;z-index:10;background:rgba(16,36,59,.42);display:grid;place-items:center;padding:20px}.alert-modal{width:min(560px,100%);background:#fff;border-top:5px solid var(--red);border-radius:12px;padding:26px;box-shadow:0 18px 50px rgba(16,36,59,.28)}.alert-heading{display:flex;gap:13px;align-items:flex-start}.alert-heading>span{font-size:28px;color:var(--red)}.alert-heading h2{margin-top:4px}.alert-kicker{font-weight:800;letter-spacing:.08em;color:var(--red);margin:24px 0 15px}.alert-details{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.alert-details p{margin:0;padding:12px;background:#f7fafc;border:1px solid #edf0f3;border-radius:8px}.alert-details b,.alert-reason span{display:block;margin-top:6px;overflow-wrap:anywhere}.alert-decision{margin:18px 0;padding:15px;text-align:center;background:#fff1f0;color:var(--red);font-size:20px;font-weight:800;border:1px solid #f2c5c1;border-radius:8px}.alert-reason{color:var(--ink);line-height:1.5}.alert-reason small{display:block}.alert-modal button{margin-top:12px}@media(max-width:800px){.monitor-flow,.monitor-grid{grid-template-columns:1fr}.flow-arrow{transform:rotate(90deg);height:26px}.alert-details{grid-template-columns:1fr 1fr}}`;
    document.head.appendChild(style);
}

function createMonitorUI() {
    if (state.monitorReady) return;
    monitorStyles();
    const anchor = document.querySelector(".cols");
    if (!anchor) return;
    anchor.insertAdjacentHTML("beforebegin", `<section class="panel security-monitor"><div class="head"><div><small>REAL-TIME DEFENCE TELEMETRY</small><h2>LIVE SECURITY RESPONSE</h2></div><span id="monitor-state" class="pill good">● MONITORING</span></div><div id="monitor-empty" class="monitor-empty">Waiting for a security event...</div><div id="monitor-flow" class="monitor-flow hidden"><div class="monitor-step"><small>REQUEST RECEIVED</small><b id="live-request">—</b><span id="live-time">—</span></div><div class="flow-arrow">↓</div><div class="monitor-step"><small>SECURITY CONTROL</small><b id="live-control">—</b></div><div class="flow-arrow">↓</div><div class="monitor-step"><small>SECURITY DECISION</small><strong id="live-decision">—</strong><span id="live-reason">—</span></div><div class="flow-arrow">↓</div><div class="monitor-step recorded"><small>EVENT RECORDED</small><b>Security event log</b></div></div></section><section class="monitor-grid"><article class="panel"><div class="head"><h2>RECENT SECURITY EVENTS</h2><span class="pill" id="event-count">0 EVENTS</span></div><div id="monitor-events" class="event-list"><p>No security events recorded yet.</p></div></article><article class="panel"><div class="head"><h2>SECURITY ACTIVITY SUMMARY</h2></div><div class="activity-summary"><div><b id="activity-total">0</b><small>Events detected</small></div><div><b id="activity-blocked">0</b><small>Requests blocked</small></div><div><b id="activity-auth">0</b><small>Authentication</small></div><div><b id="activity-injection">0</b><small>Injection events</small></div></div></article></section><div id="security-alert" class="alert-backdrop hidden" role="dialog" aria-modal="true"><div class="alert-modal"><div class="alert-heading"><span>⚠</span><div><small>LIVE SECURITY RESPONSE</small><h2>SECURITY ALERT</h2></div></div><p class="alert-kicker">MALICIOUS REQUEST DETECTED</p><div class="alert-details"><p><small>ATTACK / EVENT</small><b id="alert-event">—</b></p><p><small>ENDPOINT</small><b id="alert-endpoint">—</b></p><p><small>SECURITY CONTROL</small><b id="alert-control">—</b></p></div><div id="alert-decision" class="alert-decision">REQUEST BLOCKED</div><p class="alert-reason"><small>REASON</small><span id="alert-reason-text">—</span></p><button id="alert-dismiss" class="secondary">Dismiss</button></div></div>`);
    $("alert-dismiss").addEventListener("click", () => $("security-alert").classList.add("hidden"));
    state.monitorReady = true;
}

async function checkServer() {
    try {
        const data = await api("/api/health");
        $("server").textContent =
            data.status === "running" ? "Backend online" : "Backend offline";
    } catch (_) {
        $("server").textContent = "Backend offline";
    }
}

function showDashboard() {
    $("login").classList.add("hidden");
    $("app").classList.remove("hidden");
}

function showLogin() {
    $("app").classList.add("hidden");
    $("login").classList.remove("hidden");
}

async function login(event) {
    event.preventDefault();

    $("err").textContent = "";

    try {
        const data = await api("/api/login", {
            method: "POST",
            body: JSON.stringify({
                username: $("user").value.trim(),
                password: $("pass").value
            })
        });

        state.token = data.token;
        localStorage.setItem("securewater_token", state.token);

        $("pass").value = "";
        showDashboard();

        await refreshDashboard();
        startSecurityMonitor();

        if (state.timer) clearInterval(state.timer);
        state.timer = setInterval(refreshDashboard, 15000);

    } catch (err) {
        $("err").textContent = err.message;
    }
}

async function logout() {
    try {
        await api("/api/logout", { method: "POST" });
    } catch (_) {}

    state.token = null;
    localStorage.removeItem("securewater_token");

    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    if (state.monitorTimer) clearInterval(state.monitorTimer);
    state.monitorTimer = null;
    state.latestEventKey = null;

    showLogin();
}

async function loadSensorData() {
    const data = await api("/api/thingspeak/latest");

    text("temp",
        data.temperature !== null
            ? Number(data.temperature).toFixed(2)
            : "—"
    );

    text("ph",
        data.ph !== null
            ? Number(data.ph).toFixed(2)
            : "—"
    );

    text("turb",
        data.turbidity !== null
            ? Number(data.turbidity).toFixed(1)
            : "—"
    );

    const waterStatus = String(data.water_status || "UNKNOWN").toUpperCase();
    text("status", waterStatus);
    $("status").classList.remove("status-safe", "status-unsafe", "status-unknown");
    $("status").classList.add(
        waterStatus === "SAFE"
            ? "status-safe"
            : waterStatus === "UNSAFE"
                ? "status-unsafe"
                : "status-unknown"
    );
    text("channel", data.channel_id || "—");
    text("entry", data.entry_id || "—");

    text(
        "updated",
        data.created_at
            ? new Date(data.created_at).toLocaleString()
            : "—"
    );

    text(
        "time",
        data.created_at
            ? new Date(data.created_at).toLocaleString()
            : "Waiting"
    );

    $("feed").textContent =
        data.water_status === "SAFE" ? "PASS" : "CHECK";

    $("feed").className =
        data.water_status === "SAFE"
            ? "pill good"
            : "pill bad";
}

async function loadControls() {
    const data = await api("/api/security/controls");
    const container = $("controls");

    container.innerHTML = "";

    data.controls.forEach(control => {
        const row = document.createElement("p");

        const name = document.createElement("span");
        name.textContent = control.name;

        const status = document.createElement("b");
        status.textContent = control.status;

        row.append(name, status);
        container.appendChild(row);
    });
}

function eventDetails(event) {
    const type = String(event.event_type || "SECURITY EVENT");
    const details = {
        UNAUTHORIZED_ACCESS: ["Unauthorised Access", "Authentication", "POST /api/tests/unauthorized"],
        DDOS_RATE_FLOOD: ["DDoS / Rate Flood", "Rate Limiting", "POST /api/tests/rate-flood"],
        FAKE_SENSOR_INJECTION: ["Fake Sensor Injection", "Input Validation", "POST /api/tests/fake-sensor"],
        DEBUG_INFORMATION_EXPOSURE: ["Debug Information Exposure", "Debug Exposure Control", "GET /api/tests/debug-exposure"],
        SQL_COMMAND_INJECTION: ["SQL / Command Injection", "Injection Protection", "POST /api/tests/injection"],
        BRUTE_FORCE_AUTH: ["Brute-force Authentication", "Authentication Rate Limiting", "POST /api/tests/bruteforce"],
        MITM_PLAINTEXT_TRANSMISSION: ["MITM / Plaintext Transmission", "Secure Transport Policy", "POST /api/tests/mitm"]
    };
    const match = details[type] || [type.replaceAll("_", " "), "Security Control", "Protected endpoint"];
    const endpoint = event.endpoint || match[2];
    return {
        name: match[0],
        control: event.control || match[1],
        endpoint: event.method && endpoint ? `${event.method} ${endpoint}` : endpoint,
        status: event.http_status
    };
}

function eventKey(event) {
    return event.id ?? `${event.timestamp}|${event.event_type}|${event.description}|${event.result}`;
}

function eventReason(event) {
    const description = String(event.reason || event.description || "Security control processed the request.");
    return description.replace(/^Controlled (?:burst|abnormal sensor payload|sequence of seven failed authentication attempts)[: ]*/i, "");
}

function updateLiveEvent(event, alert = false) {
    const details = eventDetails(event);
    $("monitor-empty").classList.add("hidden");
    $("monitor-flow").classList.remove("hidden");
    text("live-request", details.endpoint);
    text("live-control", details.control);
    text("live-decision", String(event.result || "UNKNOWN").toUpperCase() === "BLOCKED" ? "REQUEST BLOCKED" : String(event.result || "UNKNOWN").toUpperCase());
    text("live-reason", details.status ? `HTTP ${details.status} · ${eventReason(event)}` : eventReason(event));
    text("live-time", event.timestamp ? new Date(event.timestamp).toLocaleString() : "Time unavailable");
    $("live-decision").className = String(event.result || "").toUpperCase() === "BLOCKED" ? "" : "decision-allowed";
    if (!alert) return;
    text("alert-event", details.name);
    text("alert-endpoint", details.endpoint);
    text("alert-control", details.control);
    text("alert-decision", String(event.result || "UNKNOWN").toUpperCase() === "BLOCKED" ? "REQUEST BLOCKED" : `REQUEST ${String(event.result || "UNKNOWN").toUpperCase()}`);
    text("alert-reason-text", details.status ? `HTTP ${details.status} · ${eventReason(event)}` : eventReason(event));
    if ($("alert-event")) {
        const kicker = document.querySelector(".alert-kicker");
        if (kicker) kicker.textContent = typeIsRateFlood(event) ? "DDOS / RATE FLOOD DETECTED" : "MALICIOUS REQUEST DETECTED";
    }
    if (details.status) text("alert-status", `HTTP ${details.status}`);
    $("security-alert").classList.remove("hidden");
}

function typeIsRateFlood(event) {
    return String(event.event_type || "").toUpperCase() === "DDOS_RATE_FLOOD";
}

function renderMonitorEvents(events) {
    [$("monitor-events"), $("events")].filter(Boolean).forEach(container => {
        container.textContent = "";
        if (!events.length) {
            const empty = document.createElement("p");
            empty.textContent = "No security events recorded yet.";
            container.appendChild(empty);
            return;
        }
        events.slice(0, 20).forEach(event => {
            const details = eventDetails(event);
            const item = document.createElement("div");
            item.className = "event";
            const title = document.createElement("b");
            title.textContent = details.name;
            const description = document.createElement("p");
            description.textContent = eventReason(event);
            const meta = document.createElement("small");
            meta.textContent = `${event.timestamp ? new Date(event.timestamp).toLocaleString() : "Time unavailable"} · ${details.control} · ${String(event.result || "UNKNOWN").toUpperCase()}`;
            item.append(title, description, meta);
            container.appendChild(item);
        });
    });
}

function renderActivity(events) {
    const blocked = events.filter(event => String(event.result || "").toUpperCase() === "BLOCKED").length;
    const authEvents = events.filter(event => /AUTH/i.test(String(event.event_type || ""))).length;
    const injectionEvents = events.filter(event => /INJECTION/i.test(String(event.event_type || ""))).length;
    text("activity-total", events.length);
    text("activity-blocked", blocked);
    text("activity-auth", authEvents);
    text("activity-injection", injectionEvents);
    text("event-count", `${events.length} EVENTS`);
}

function renderRequestActivity(activity) {
    text("activity-total", activity.received || 0);
    text("activity-blocked", activity.blocked || 0);
    text("activity-auth", activity.allowed || 0);
    text("activity-injection", Object.entries(activity.statuses || {}).map(([status, count]) => `${status}: ${count}`).join(" · ") || "—");
    const labels = document.querySelectorAll(".activity-summary small");
    if (labels.length >= 4) {
        labels[0].textContent = "Requests received";
        labels[1].textContent = "Requests blocked";
        labels[2].textContent = "Requests allowed";
        labels[3].textContent = "HTTP status totals";
    }
}

async function loadEvents() {
    const data = await api("/api/security/events");
    const events = Array.isArray(data.events) ? data.events : [];
    renderMonitorEvents(events);
    renderActivity(events);
    const newest = events[0];
    if (!newest) return;
    const newestKey = eventKey(newest);
    const isNew = state.latestEventKey !== null && newestKey !== state.latestEventKey;
    state.latestEventKey = newestKey;
    updateLiveEvent(newest, isNew);
}

async function loadSummary() {
    const data = await api("/api/security/summary");

    text(
        "summary",
        `${data.events} events recorded · ${data.blocked} blocked`
    );

    const evaluation = $("evaluation");
    evaluation.innerHTML = "";

    const controls = [
        ["Authentication", "Implemented"],
        ["Input validation", "Implemented"],
        ["Rate limiting", "Implemented"],
        ["Security logging", "Implemented"],
        ["Debug exposure control", "Implemented"],
        ["Injection protection", "Implemented"],
        ["Secure transport policy", "Demonstration"]
    ];

    controls.forEach(([name, status]) => {
        const row = document.createElement("p");

        const label = document.createElement("span");
        label.textContent = name;

        const value = document.createElement("b");
        value.textContent = status;

        row.append(label, value);
        evaluation.appendChild(row);
    });
}

async function loadRequestActivity() {
    renderRequestActivity(await api("/api/security/activity"));
}

async function refreshDashboard() {
    if (!state.token) return;

    try {
        await Promise.all([
            loadSensorData(),
            loadControls(),
            loadEvents(),
            loadSummary(),
            loadRequestActivity()
        ]);
    } catch (err) {
        if (err.status === 401) {
            await logout();
        }
    }
}

async function pollSecurityEvents() {
    if (!state.token || state.monitorRequest) return;
    state.monitorRequest = true;
    try {
        await loadEvents();
        await loadRequestActivity();
    } catch (err) {
        if (err.status === 401) await logout();
        else if ($("monitor-state")) text("monitor-state", "● MONITORING · TEMPORARILY UNAVAILABLE");
    } finally {
        state.monitorRequest = false;
    }
}

function startSecurityMonitor() {
    createMonitorUI();
    state.latestEventKey = null;
    if (state.monitorTimer) clearInterval(state.monitorTimer);
    state.monitorTimer = setInterval(pollSecurityEvents, 1500);
}

function showTestResult(data) {
    const result = $("result");

    result.classList.remove("hidden");
    result.innerHTML = "";

    const title = document.createElement("strong");
    title.textContent =
        `${data.test}: ${data.status}`;

    const detail = document.createElement("p");
    detail.textContent =
        data.detail ||
        data.control ||
        (data.reasons
            ? data.reasons.join("; ")
            : "Controlled assessment test completed.");

    result.append(title, detail);
}

async function runTest(test) {
    try {
        const options = {
            method: "POST"
        };

        if (test === "fake-sensor") {
            options.body = JSON.stringify({
                temperature: 999,
                ph: -5,
                turbidity: 250
            });
        }

        if (test === "injection") {
            options.body = JSON.stringify({
                payload: "' OR 1=1; DROP TABLE security_events; --"
            });
        }

        const data = await api(`/api/tests/${test}`, options);

        showTestResult(data);

        await loadEvents();
        await loadSummary();

    } catch (err) {
        const result = $("result");
        result.classList.remove("hidden");
        result.textContent = err.message;
    }
}

document.addEventListener("DOMContentLoaded", async () => {

    createMonitorUI();

    $("form").addEventListener("submit", login);

    $("logout").addEventListener("click", logout);

    document.querySelectorAll("[data-t]").forEach(button => {
        button.addEventListener("click", () => {
            runTest(button.dataset.t);
        });
    });

    await checkServer();
});