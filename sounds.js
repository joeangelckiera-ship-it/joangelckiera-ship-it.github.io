// =========================================================
// Class Chat - Sound Effects (separate file, no audio files needed)
// Add this to index.html, after script.js:
//   <script src="sounds.js"></script>
// =========================================================
(function () {
    let ctx = null;
    let muted = localStorage.getItem("cc-muted") === "1";
    let quietUntil = 0; // stops the "new message" sound while history loads
  
    // Browsers only allow sound after the user clicks/types once
    function audio() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }
  
    // Play one tone: frequency, length (s), wave type, volume, optional pitch slide
    function tone(freq, dur, type, vol, slideTo, delay) {
      if (muted) return;
      const c = audio();
      const t = c.currentTime + (delay || 0);
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      gain.gain.setValueAtTime(vol || 0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
  
    // ---------- The sounds ----------
    const sounds = {
      key()     { tone(1100 + Math.random() * 400, 0.04, "square", 0.025); },
      click()   { tone(520, 0.07, "triangle", 0.09, 300); },
      hover()   { tone(900, 0.03, "sine", 0.02); },
      send()    { tone(400, 0.12, "sawtooth", 0.05, 900); tone(900, 0.08, "sine", 0.05, null, 0.08); },
      receive() { tone(880, 0.12, "sine", 0.07); tone(1320, 0.18, "sine", 0.06, null, 0.1); },
      bot()     { tone(300, 0.1, "square", 0.04, 600); tone(600, 0.12, "square", 0.04, 300, 0.1); },
      login()   { [262, 330, 392, 523].forEach((f, i) => tone(f, 0.18, "triangle", 0.07, null, i * 0.09)); },
      logout()  { [523, 392, 330, 262].forEach((f, i) => tone(f, 0.18, "triangle", 0.06, null, i * 0.09)); },
      error()   { tone(180, 0.25, "sawtooth", 0.07, 90); },
    };
  
    // ---------- Typing sounds ----------
    document.addEventListener("keydown", (e) => {
      const t = e.target;
      if (!t || (t.tagName !== "INPUT" && t.tagName !== "TEXTAREA")) return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Enter") return; // Enter is handled by the send/submit sound
      if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(e.key)) return;
      sounds.key();
    });
  
    // ---------- Button clicks ----------
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (btn) sounds.click();
    });
  
    // ---------- Button hover (soft tick) ----------
    document.addEventListener("pointerover", (e) => {
      const btn = e.target.closest("button");
      if (btn && !btn.contains(e.relatedTarget)) sounds.hover();
    });
  
    // ---------- Sending a message / command ----------
    document.addEventListener("submit", (e) => {
      if (e.target.id !== "message-form") return;
      const input = document.getElementById("message-input");
      const text = input ? input.value.trim() : "";
      if (!text) return;
      text.startsWith("/") ? sounds.bot() : sounds.send();
    }, true); // capture = runs before your script clears the box
  
    // ---------- Incoming messages, bot replies, errors ----------
    const list = document.getElementById("messages");
    if (list) {
      new MutationObserver((mutations) => {
        if (Date.now() < quietUntil) return;
        mutations.forEach((m) => {
          m.addedNodes.forEach((node) => {
            if (!node.classList) return;
            if (node.classList.contains("bot")) return;      // bot sound already played on submit
            if (node.classList.contains("mine")) return;     // my own message
            sounds.receive();                                // someone else's message
          });
        });
      }).observe(list, { childList: true });
    }
  
    // ---------- Login / logout sounds ----------
    const chatScreen = document.getElementById("chat-screen");
    if (chatScreen) {
      let wasHidden = chatScreen.hidden;
      new MutationObserver(() => {
        if (chatScreen.hidden === wasHidden) return;
        wasHidden = chatScreen.hidden;
        if (!chatScreen.hidden) {
          quietUntil = Date.now() + 2500; // ignore history loading
          sounds.login();
        } else {
          sounds.logout();
        }
      }).observe(chatScreen, { attributes: true, attributeFilter: ["hidden"] });
    }
  
    // Error sound when the login message shows an error
    const authMessage = document.getElementById("auth-message");
    if (authMessage) {
      new MutationObserver(() => {
        const t = authMessage.textContent.trim();
        if (t && !/^(Creating|Logging|Check your email)/.test(t)) sounds.error();
      }).observe(authMessage, { childList: true, characterData: true, subtree: true });
    }
  
    // ---------- Mute button (bottom-left corner) ----------
    const mute = document.createElement("button");
    mute.type = "button";
    mute.title = "Toggle sound";
    mute.style.cssText =
      "position:fixed;left:14px;bottom:14px;z-index:50;width:42px;height:42px;" +
      "padding:0;border-radius:50%;font-size:18px;letter-spacing:0;";
    const paint = () => (mute.textContent = muted ? "🔇" : "🔊");
    paint();
    mute.addEventListener("click", () => {
      muted = !muted;
      localStorage.setItem("cc-muted", muted ? "1" : "0");
      paint();
      if (!muted) sounds.click();
    });
    document.body.appendChild(mute);
  })();