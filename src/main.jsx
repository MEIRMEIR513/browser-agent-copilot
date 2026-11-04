import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  const socketRef = useRef(null);
  const feedRef = useRef(null);
  const [socketReady, setSocketReady] = useState(false);
  const [providers, setProviders] = useState([]);
  const [provider, setProvider] = useState("devin");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("connecting");
  const [snapshot, setSnapshot] = useState({ url: "", title: "", text: "", elements: [] });
  const [screenshot, setScreenshot] = useState("");
  const [approval, setApproval] = useState(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${location.host}/socket`);
    socketRef.current = socket;
    socket.onopen = () => setSocketReady(true);
    socket.onclose = () => { setSocketReady(false); setConfigured(false); setStatus("disconnected"); };
    socket.onmessage = ({ data }) => {
      const event = JSON.parse(data);
      if (event.type === "providers") setProviders(event.providers);
      if (event.type === "browser_update") {
        if (event.snapshot) setSnapshot(event.snapshot);
        if (event.screenshot !== undefined) setScreenshot(event.screenshot);
        if (event.warning) setNotice(event.warning);
      }
      if (event.type === "configured") setConfigured(true);
      if (event.type === "status") setStatus(event.status);
      if (event.type === "approval_required") setApproval(event);
      if (event.type === "approval_resolved") setApproval(null);
      if (event.type === "message") setMessages((items) => [...items, { role: event.role, content: event.content }]);
      if (event.type === "action") setMessages((items) => [...items, { role: "action", content: `${event.name} ${JSON.stringify(event.args)}` }]);
      if (event.type === "tool_result") setMessages((items) => [...items, { role: "result", content: event.content }]);
      if (event.type === "error") setNotice(event.message);
    };
    return () => socket.close();
  }, []);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [messages, approval]);

  const send = (event) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setNotice("The server connection is closed. Reload the page to reconnect.");
      return;
    }
    socketRef.current.send(JSON.stringify(event));
  };

  async function discover(event) {
    event.preventDefault();
    setNotice("");
    setDiscovering(true);
    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setModels(result.models);
      setModel(result.models[0]?.id ?? "");
      // Auto-configure after discovering
      configure();
      if (!result.models.length) setNotice("No models available for this key.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setDiscovering(false);
    }
  }

  function configure() {
    setNotice("");
    if (!model) {
      setNotice("Please click 'Connect' to load the default model.");
      return;
    }
    send({ type: "configure", provider, model, apiKey, vision: models.find((item) => item.id === model)?.vision });
  }

  function submitMessage(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !configured) return;
    setDraft("");
    send({ type: "chat", content });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">B</div>
        <div><strong>Browser Agent</strong><span>Real browser · live session</span></div>
        <div className={`connection ${socketReady ? "online" : ""}`}><i />{socketReady ? status : "Connecting"}</div>
      </header>
      <div className="workspace">
        <section className="left-column">
          <section className="panel setup-panel">
            <div className="panel-heading"><div><span className="eyebrow">01 / CONNECTION</span><h2>Model provider</h2></div><span className="step-dot">●</span></div>
            <form onSubmit={discover}>
              <label>Provider<select value={provider} onChange={(event) => { setProvider(event.target.value); setApiKey(""); setModels([]); setModel(""); setConfigured(false); }}>
                {providers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
              </select></label>
              <p className="muted">Devin CLI must be installed and authenticated. Run <code>devin auth login</code> to authenticate.</p>
              <button className="secondary-button" disabled={discovering}>{discovering ? "Loading models…" : "Connect"}</button>
            </form>
            {notice && <p className="notice">{notice}</p>}
            <p className="muted">UI keys stay in memory. You can also configure provider keys on the server via environment variables.</p>
          </section>
          <section className="panel browser-panel">
            <div className="panel-heading"><div><span className="eyebrow">02 / LIVE BROWSER</span><h2>Current page</h2></div></div>
            <div className="url-chip">{snapshot.url || "No page opened yet"}</div>
            <h3>{snapshot.title || "Your browser is ready"}</h3>
            {screenshot && <img className="browser-screenshot" src={`data:image/jpeg;base64,${screenshot}`} alt="Current headless browser page" />}
            <div className="page-summary">{snapshot.text || "Ask the agent to open a URL. The page stays live while the agent works."}</div>
            <div className="element-list">
              {snapshot.elements?.slice(0, 8).map((element, index) => <div key={`${element.selector}-${index}`}><span>{element.tag}</span>{element.label}</div>)}
            </div>
          </section>
        </section>
        <section className="panel chat-panel">
          <div className="panel-heading chat-heading"><div><span className="eyebrow">03 / ASSISTANT</span><h2>What should I do?</h2></div><button className="stop-button" disabled={status !== "working"} onClick={() => send({ type: "stop" })}>■ Stop</button></div>
          <div className="chat-feed" ref={feedRef}>
            {messages.length === 0 && <div className="welcome-card"><div className="sparkle">✳</div><h3>Give your browser a task.</h3><p>The agent will inspect the page, explain what it sees, and work through actions one at a time. You can send more instructions while it runs.</p><button className="suggestion" onClick={() => setDraft("Open https://example.com and describe what you see.")}>↗ Open a page and describe it</button></div>}
            {messages.map((message, index) => <article className={`message ${message.role}`} key={`${index}-${message.role}`}><span>{message.role === "assistant" ? "AGENT" : message.role === "user" ? "YOU" : message.role === "action" ? "ACTION" : "RESULT"}</span><p>{message.content}</p></article>)}
            {approval && <div className="approval-card"><strong>Approval needed</strong><p>{approval.action}</p><div><button className="secondary-button" onClick={() => send({ type: "approval", id: approval.id, approved: false })}>Decline</button><button className="primary-button" onClick={() => send({ type: "approval", id: approval.id, approved: true })}>Approve action</button></div></div>}
          </div>
          <form className="composer" onSubmit={submitMessage}>
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitMessage(event); } }} disabled={!configured} placeholder={configured ? "Tell the agent what to do… (Enter to send)" : "Connect a provider to start chatting"} rows="2" />
            <button className="send-button" aria-label="Send message" disabled={!configured || !draft.trim()}>↑</button>
          </form>
          <div className="chat-footnote"><span className="safe-icon">◆</span> Important actions pause for your approval <span>·</span> You can stop at any time</div>
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
