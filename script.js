// ---------- 1. Connect to Supabase ----------
const SUPABASE_URL = "https://oaxktuhiilnbklandxsd.supabase.co";
const SUPABASE_KEY = "sb_publishable_eenPqyP7fih8l7ZXZ3AZPQ_b_fogTyV";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- 2. Grab page elements ----------
const authScreen = document.getElementById("auth-screen");
const chatScreen = document.getElementById("chat-screen");
const authForm = document.getElementById("auth-form");
const authMessage = document.getElementById("auth-message");
const displayName = document.getElementById("display-name");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const signupBtn = document.getElementById("signup-btn");
const logoutBtn = document.getElementById("logout-btn");
const who = document.getElementById("who");
const messageList = document.getElementById("messages");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
// NEW: the "who is online" bar
const onlineList = document.getElementById("online-list");
const onlineCount = document.getElementById("online-count");

// ---------- 3. App state ----------
let currentUser = null;
const names = {};      // user id -> display name
let channel = null;    // realtime channel
// NEW state
let presenceChannel = null;  // realtime channel for "who is online"
let sentTimes = [];          // when I sent my recent messages
const MAX_PER_MINUTE = 10;   // message limit per minute

// ---------- 4. Sign up, log in, log out ----------
async function signUp() {
  const name = displayName.value.trim();
  if (name.length < 2) {
    authMessage.textContent = "Enter a display name (2 to 24 characters).";
    return;
  }

  authMessage.textContent = "Creating your account...";
  const { data, error } = await sb.auth.signUp({
    email: emailInput.value.trim(),
    password: passwordInput.value,
    options: { data: { display_name: name } },
  });

  if (error) {
    authMessage.textContent = error.message;
  } else if (!data.session) {
    authMessage.textContent = "Check your email to confirm your account.";
  } else {
    authMessage.textContent = "";
  }
}

async function logIn() {
  authMessage.textContent = "Logging in...";
  const { error } = await sb.auth.signInWithPassword({
    email: emailInput.value.trim(),
    password: passwordInput.value,
  });
  authMessage.textContent = error ? error.message : "";
}

authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  logIn();
});

signupBtn.addEventListener("click", () => {
  if (authForm.reportValidity()) signUp();
});

logoutBtn.addEventListener("click", () => sb.auth.signOut());

// ---------- 5. React to login / logout ----------
sb.auth.onAuthStateChange((event, session) => {
  const user = session ? session.user : null;

  setTimeout(() => {
    if (user && (!currentUser || currentUser.id !== user.id)) startChat(user);
    if (!user && currentUser) stopChat();
  }, 0);
});

async function startChat(user) {
  currentUser = user;
  authScreen.hidden = true;
  chatScreen.hidden = false;
  who.textContent = "Loading...";

  await loadNames();
  who.textContent = names[user.id] || "Signed in";
  await loadMessages();
  listenForNewMessages();
  startPresence(); // NEW: show who is online
  await loadReactions(); // NEW: reactions on the messages already shown
  startReactions();      // NEW: live reactions
  messageInput.focus();
}

function stopChat() {
  currentUser = null;
  if (channel) sb.removeChannel(channel);
  channel = null;
  stopPresence(); // NEW
  stopReactions(); // NEW
  messageList.innerHTML = "";
  passwordInput.value = "";
  chatScreen.hidden = true;
  authScreen.hidden = false;
}

// ---------- 6. (reserved) ----------

// ---------- 7. Show one message ----------
function showMessage(msg) {
  if (messageList.querySelector('[data-id="' + msg.id + '"]')) return;

  const isMine = msg.user_id === currentUser.id;
  const item = document.createElement("li");
  item.className = isMine ? "message mine" : "message";
  item.dataset.id = msg.id;

  const author = document.createElement("span");
  author.className = "author";
  author.textContent = names[msg.user_id] || "Unknown";

  const text = document.createElement("p");
  text.textContent = msg.content;

  const time = document.createElement("time");
  time.textContent = new Date(msg.created_at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  item.append(author, text, time);

  // NEW: Unsend button on my own messages
  if (isMine) {
    const unsend = document.createElement("button");
    unsend.type = "button";
    unsend.className = "unsend";
    unsend.textContent = "Unsend";
    unsend.title = "Delete this message for everyone";
    unsend.addEventListener("click", () => unsendMessage(msg.id));
    item.appendChild(unsend);
  }

  // NEW: reactions (like Messenger)
  addReactionUI(item, msg.id);

  messageList.appendChild(item);
  messageList.scrollTop = messageList.scrollHeight;
}

// ---------- 8. Send a message ----------
messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const content = messageInput.value.trim();
  if (content === "") return;
  messageInput.value = "";

  // Commands (like /weather) are handled here and never saved
  if (content.startsWith("/")) {
    handleCommand(content);
    return;
  }

  // NEW: message limit (MAX_PER_MINUTE messages per minute)
  const nowMs = Date.now();
  sentTimes = sentTimes.filter((t) => nowMs - t < 60000);
  if (sentTimes.length >= MAX_PER_MINUTE) {
    alert("Slow down! You can only send " + MAX_PER_MINUTE + " messages per minute.");
    messageInput.value = content;
    return;
  }

  // We send ONLY the text. The database fills in user_id from the login token.
  const { data, error } = await sb
    .from("messages")
    .insert({ content: content })
    .select()
    .single();

  // NEW: the database's own per-minute rule said no
  if (error && error.message.includes("row-level security")) {
    alert("Slow down! You can only send " + MAX_PER_MINUTE + " messages per minute.");
    messageInput.value = content;
    return;
  }

  if (error) {
    alert("Could not send: " + error.message);
    messageInput.value = content;
    return;
  }
  sentTimes.push(Date.now()); // NEW
  showMessage(data);
});

// ---------- 9. Load names and message history ----------
async function loadNames() {
  const { data, error } = await sb
    .from("profiles")
    .select("id, display_name");
  if (error) return console.error(error);

  data.forEach((p) => {
    names[p.id] = p.display_name;
  });
}

async function nameFor(userId) {
  if (names[userId]) return names[userId];

  const { data } = await sb
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .single();

  names[userId] = data ? data.display_name : "Unknown";
  return names[userId];
}

async function loadMessages() {
  const { data, error } = await sb
    .from("messages")
    .select("id, user_id, content, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return console.error(error);

  // We asked for newest first, so flip the list to show oldest first
  data.reverse().forEach(showMessage);
}

// ---------- 10. Realtime: new and deleted messages ----------
function listenForNewMessages() {
  if (channel) sb.removeChannel(channel);

  channel = sb
    .channel("class-chat")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      async (payload) => {
        await nameFor(payload.new.user_id);
        showMessage(payload.new);
      }
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "messages" },
      (payload) => removeMessage(payload.old.id)
    )
    .subscribe();
}

function removeMessage(id) {
  const item = messageList.querySelector('[data-id="' + id + '"]');
  if (item) item.remove();
}

// ---------- 10b. NEW: Unsend (delete my own message) ----------
async function unsendMessage(id) {
  const { data, error } = await sb
    .from("messages")
    .delete()
    .eq("id", id)
    .select();

  if (error) {
    alert("Could not unsend: " + error.message);
    return;
  }
  if (!data || data.length === 0) {
    alert("Could not unsend that message.");
    return;
  }
  removeMessage(id); // everyone else's screen is updated by the realtime DELETE event
}

// ---------- 10c. NEW: Who is online (Realtime Presence) ----------
function startPresence() {
  if (presenceChannel) sb.removeChannel(presenceChannel);

  presenceChannel = sb
    // the key is my user id, so two tabs of the same person count once
    .channel("online-users", { config: { presence: { key: currentUser.id } } })
    .on("presence", { event: "sync" }, showOnline)
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        // tell everyone "I'm online"
        await presenceChannel.track({ name: names[currentUser.id] || "Someone" });
      }
    });
}

function stopPresence() {
  if (presenceChannel) sb.removeChannel(presenceChannel);
  presenceChannel = null;
  onlineList.innerHTML = "";
  onlineCount.textContent = "0";
}

function showOnline() {
  if (!presenceChannel) return;
  const state = presenceChannel.presenceState(); // { userId: [ { name, ... } ] }
  const ids = Object.keys(state);

  onlineList.innerHTML = "";
  ids.forEach((id) => {
    const meta = state[id][0];

    const chip = document.createElement("span");
    chip.className = "online-user";

    const dot = document.createElement("i");
    dot.className = "online-dot";

    const label = (meta.name || names[id] || "Someone") +
      (id === currentUser.id ? " (you)" : "");
    chip.append(dot, label);
    onlineList.appendChild(chip);
  });
  onlineCount.textContent = ids.length;
}

// ---------- 10d. NEW: Reactions (like Messenger) ----------
// One reaction per person per message. Click the same emoji again to remove it.
const REACTION_EMOJIS = ["\u2764\uFE0F", "\u{1F606}", "\u{1F62E}", "\u{1F622}", "\u{1F621}", "\u{1F44D}"];
const reactions = {};         // messageId -> { userId: emoji }
let reactionChannel = null;   // realtime channel for reactions

function closePickers() {
  document.querySelectorAll(".reaction-picker.open").forEach((p) => p.classList.remove("open"));
}
document.addEventListener("click", closePickers);

// Adds the smiley button, the emoji bar and the reaction chips to one message
function addReactionUI(item, msgId) {
  const reactBtn = document.createElement("button");
  reactBtn.type = "button";
  reactBtn.className = "react-btn";
  reactBtn.title = "React";
  reactBtn.textContent = "\u{1F642}";

  const picker = document.createElement("div");
  picker.className = "reaction-picker";
  REACTION_EMOJIS.forEach((emoji) => {
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "reaction-pick";
    pick.dataset.emoji = emoji;
    pick.textContent = emoji;
    pick.addEventListener("click", (event) => {
      event.stopPropagation();
      picker.classList.remove("open");
      toggleReaction(msgId, emoji);
    });
    picker.appendChild(pick);
  });

  reactBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const wasOpen = picker.classList.contains("open");
    closePickers();
    if (wasOpen) return;

    // open the bar below the message if there is no room above it
    const room = item.getBoundingClientRect().top - messageList.getBoundingClientRect().top;
    picker.classList.toggle("below", room < 70);

    // highlight the emoji I already chose
    const mine = (reactions[String(msgId)] || {})[currentUser.id];
    picker.querySelectorAll(".reaction-pick").forEach((b) => {
      b.classList.toggle("chosen", b.dataset.emoji === mine);
    });
    picker.classList.add("open");
  });

  const chips = document.createElement("div");
  chips.className = "reactions";

  item.append(reactBtn, picker, chips);
  renderReactions(msgId, item);
}

// Draw the little emoji chips under a message
function renderReactions(msgId, item) {
  const li = item || messageList.querySelector('[data-id="' + msgId + '"]');
  if (!li) return;
  const box = li.querySelector(".reactions");
  if (!box) return;

  const byUser = reactions[String(msgId)] || {};
  const who = {}; // emoji -> list of names
  Object.keys(byUser).forEach((uid) => {
    const emoji = byUser[uid];
    (who[emoji] = who[emoji] || []).push(uid === currentUser.id ? "You" : (names[uid] || "Someone"));
  });

  box.innerHTML = "";
  REACTION_EMOJIS.filter((e) => who[e]).forEach((emoji) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "reaction-chip" + (byUser[currentUser.id] === emoji ? " mine" : "");
    chip.title = who[emoji].join(", ");
    chip.append(emoji);
    if (who[emoji].length > 1) {
      const count = document.createElement("b");
      count.textContent = who[emoji].length;
      chip.appendChild(count);
    }
    chip.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleReaction(msgId, emoji);
    });
    box.appendChild(chip);
  });

  li.classList.toggle("has-reactions", box.children.length > 0);
}

// Remember (or forget) one person's reaction, then redraw that message
function setReaction(key, userId, emoji) {
  if (emoji) {
    (reactions[key] = reactions[key] || {})[userId] = emoji;
  } else if (reactions[key]) {
    delete reactions[key][userId];
    if (Object.keys(reactions[key]).length === 0) delete reactions[key];
  }
  renderReactions(key);
}

// I clicked an emoji: add it, change it, or remove it
async function toggleReaction(msgId, emoji) {
  const key = String(msgId);
  const before = (reactions[key] || {})[currentUser.id] || null;
  const removing = before === emoji;

  setReaction(key, currentUser.id, removing ? null : emoji); // show it right away

  let result;
  if (removing) {
    result = await sb
      .from("message_reactions")
      .delete()
      .eq("message_id", msgId)
      .eq("user_id", currentUser.id);
  } else {
    result = await sb
      .from("message_reactions")
      .upsert(
        { message_id: msgId, user_id: currentUser.id, emoji: emoji },
        { onConflict: "message_id,user_id" }
      );
  }

  if (result.error) {
    setReaction(key, currentUser.id, before); // put it back
    alert("Could not react: " + result.error.message);
  }
}

// Load the reactions of the messages that are on screen
async function loadReactions() {
  const ids = Array.from(messageList.querySelectorAll("[data-id]")).map((li) => li.dataset.id);
  if (ids.length === 0) return;

  const { data, error } = await sb
    .from("message_reactions")
    .select("message_id, user_id, emoji")
    .in("message_id", ids);
  if (error) return console.error(error);

  Object.keys(reactions).forEach((k) => delete reactions[k]);
  data.forEach((r) => {
    const key = String(r.message_id);
    (reactions[key] = reactions[key] || {})[r.user_id] = r.emoji;
  });
  ids.forEach((id) => renderReactions(id));
}

// Live: see other people's reactions as they happen
function startReactions() {
  if (reactionChannel) sb.removeChannel(reactionChannel);

  reactionChannel = sb
    .channel("reactions")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "message_reactions" },
      (payload) => {
        if (payload.eventType === "DELETE") {
          const old = payload.old;
          if (old && old.message_id !== undefined && old.user_id) {
            setReaction(String(old.message_id), old.user_id, null);
          }
        } else {
          const r = payload.new;
          setReaction(String(r.message_id), r.user_id, r.emoji);
        }
      }
    )
    .subscribe();
}

function stopReactions() {
  if (reactionChannel) sb.removeChannel(reactionChannel);
  reactionChannel = null;
  Object.keys(reactions).forEach((k) => delete reactions[k]);
}

// ---------- 11. Class Chat bot (Open-Meteo API) ----------
const BOT_NAME = "Class Chat Bot (only you can see this)";

const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

function describeWeather(code) {
  if (code === 0) return "clear sky";
  if (code <= 3) return "partly cloudy";
  if (code <= 48) return "foggy";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  return "thunderstorm";
}

async function getWeather(city) {
  // Request 1: city name -> latitude and longitude
  const geoUrl = GEO_URL + "?name=" + encodeURIComponent(city) + "&count=1";
  const geoResponse = await fetch(geoUrl);
  if (!geoResponse.ok) throw new Error("Geocoding failed");
  const geoData = await geoResponse.json();

  if (!geoData.results) {
    return "Sorry, I could not find a city named " + city + ".";
  }
  const place = geoData.results[0];

  // Request 2: latitude and longitude -> current weather
  const weatherUrl =
    WEATHER_URL +
    "?latitude=" + place.latitude +
    "&longitude=" + place.longitude +
    "&current=temperature_2m,weather_code,wind_speed_10m";
  const weatherResponse = await fetch(weatherUrl);
  if (!weatherResponse.ok) throw new Error("Weather failed");
  const weatherData = await weatherResponse.json();
  const now = weatherData.current;

  return (
    place.name + ", " + place.country + ": " +
    now.temperature_2m + " degrees C, " +
    describeWeather(now.weather_code) + ", wind " +
    now.wind_speed_10m + " km/h"
  );
}

// NEW: /time <city>  (the geocoding result also contains the city's time zone)
async function getTime(city) {
  const geoUrl = GEO_URL + "?name=" + encodeURIComponent(city) + "&count=1";
  const geoResponse = await fetch(geoUrl);
  if (!geoResponse.ok) throw new Error("Geocoding failed");
  const geoData = await geoResponse.json();

  if (!geoData.results) {
    return "Sorry, I could not find a city named " + city + ".";
  }
  const place = geoData.results[0];

  const when = new Date().toLocaleString("en-US", {
    timeZone: place.timezone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return place.name + ", " + place.country + ": " + when + " (" + place.timezone + ")";
}

async function handleCommand(text) {
  const words = text.split(" ");
  const command = words[0].toLowerCase();

  // Easter egg: Crispy Noodles
  if (command === "/noodles") {
    showBotMessage("Crispy Noodles served! 🍜");
    return;
  }

  // NEW: /time command
  if (command === "/time") {
    const timeCity = words.slice(1).join(" ").trim();
    if (timeCity === "") {
      showBotMessage("Try it like this: /time Tokyo");
      return;
    }
    try {
      showBotMessage(await getTime(timeCity));
    } catch (error) {
      console.error(error);
      showBotMessage("The time service is not answering right now.");
    }
    return;
  }

  if (command !== "/weather") {
    showBotMessage("Unknown command. Try: /weather Manila or /noodles");
    return;
  }

  const city = words.slice(1).join(" ").trim();
  if (city === "") {
    showBotMessage("Try it like this: /weather Manila");
    return;
  }

  try {
    showBotMessage(await getWeather(city));
  } catch (error) {
    console.error(error);
    showBotMessage("The weather service is not answering right now.");
  }
}

function showBotMessage(text) {
  const item = document.createElement("li");
  item.className = "message bot";

  const author = document.createElement("span");
  author.className = "author";
  author.textContent = BOT_NAME;

  const body = document.createElement("p");
  body.textContent = text;

  item.append(author, body);
  messageList.appendChild(item);
  messageList.scrollTop = messageList.scrollHeight;
}