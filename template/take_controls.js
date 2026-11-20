/* Shared compact table sizing, dates and reversible deletion confirmation. */
((root) => {
  "use strict";
  const dates = take => ({created: Number.isFinite(take?.createdAt) ? take.createdAt : null,
    modified: Number.isFinite(take?.editedAt) ? take.editedAt
      : Number.isFinite(take?.updatedAt) ? take.updatedAt : Number.isFinite(take?.createdAt) ? take.createdAt : null});
  const metricLabels = {tracked: "Tracked", mean: "Mean pitch error", median: "Median pitch error", within: "Within 50 cents"};
  function metricValues(score) {
    const measured = score?.measuredSeconds ?? score?.trackedSeconds;
    return {tracked: score?.expectedSeconds > 0 ? score.coverage * 100 : null,
      mean: score?.meanAbsCents ?? null, median: score?.medianAbsCents ?? null,
      within: measured > 0 ? score.within50CentsSeconds / measured * 100 : null};
  }
  function metricDeltas(before, after) {
    const previous = metricValues(before), current = metricValues(after), changes = {};
    for (const name of Object.keys(metricLabels)) {
      const from = previous[name], to = current[name], delta = to - from;
      // Ignore floating-point noise and changes below the table's displayed precision.
      if (!Number.isFinite(from) || !Number.isFinite(to) || Math.abs(delta) < .05) continue;
      const lowerBetter = name === "mean" || name === "median", improved = lowerBetter ? delta < 0 : delta > 0;
      changes[name] = {direction: delta > 0 ? "up" : "down", improved, delta,
        description: `${metricLabels[name]} ${improved ? "improved" : "worsened"} by ${Math.abs(delta).toFixed(3)} ${lowerBetter ? "cents" : "percentage points"} (${from.toFixed(3)} to ${to.toFixed(3)}) since the previous edit.`};
    }
    return changes;
  }
  function trackDates(state, sources) {
    const takes = [...new Set(state.segments.map(s => s.takeId))].map(id => sources.get(id)).filter(Boolean);
    const created = takes.map(t => dates(t).created).filter(Number.isFinite);
    const modified = takes.map(t => dates(t).modified).filter(Number.isFinite);
    return {createdAt: created.length ? Math.min(...created) : state.createdAt ?? null,
      updatedAt: modified.length ? Math.max(...modified, state.editedAt || 0) : state.editedAt ?? state.updatedAt ?? null};
  }
  function showDates(row, take) {
    for (const [column, value] of Object.entries(dates(take))) {
      const cell = row.querySelector(`.take-${column}`);
      if (!cell) continue;
      cell.dataset.timestamp = value === null ? "" : String(value);
      const date = new Date(value);
      cell.textContent = formatDate(value);
      cell.title = value === null ? "Date unavailable" : date.toLocaleString();
    }
  }
  function formatDate(value, {omitYear = false, timeOnly = false} = {}) {
    if (value === null || !Number.isFinite(value)) return "\u2014";
    return new Date(value).toLocaleString(undefined, {
      ...(!timeOnly ? {month:"numeric", day:"numeric", ...(!omitYear ? {year:"2-digit"} : {})} : {}),
      hour:"2-digit", minute:"2-digit", hour12:false,
    }).replace(/, /g, " ");
  }
  function compactDates(container) {
    const cells = [...container.querySelectorAll("[data-timestamp]")];
    const values = cells.filter(c => c.dataset.timestamp !== "").map(c => Number(c.dataset.timestamp));
    const omitYear = new Set(values.map(t => new Date(t).getFullYear())).size === 1;
    for (const cell of cells) {
      const value = cell.dataset.timestamp === "" ? null : Number(cell.dataset.timestamp);
      const created = cell.closest(".take-row")?.querySelector(".take-created")?.dataset.timestamp;
      const timeOnly = value !== null && cell.classList.contains("take-modified") && created
        && new Date(Number(created)).toDateString() === new Date(value).toDateString();
      cell.textContent = formatDate(value, {omitYear, timeOnly});
    }
  }
  const fields = {singer:"Singer", part:"Part", tracked:"Tracked (%)", mean:"Mean (\u00a2)", segments:"Segments",
    median:"Median (\u00a2)", within:"\u226450\u00a2 (%)", created:"Created", modified:"Modified", octave:"Octave"};
  const priority = ["singer","part","mean","segments","tracked","within","created","median","modified","octave"];
  const layouts = new WeakMap();
  function visibleFields(available, widths, budget, preference) {
    if (preference === "all") return available;
    if (Array.isArray(preference)) return available.filter(key => preference.includes(key));
    const included = new Set();
    for (const key of priority) {
      if (!available.includes(key)) continue;
      if (widths[key] <= budget) { included.add(key); budget -= widths[key]; }
    }
    return available.filter(key => included.has(key));
  }
  function tablePreferences(panel, stationMode) {
    const find = selector => panel.querySelector(selector), table = find(".take-review");
    const expand = find("#expandTakes"), menu = find("#takeFieldMenu"), trigger = find("#takeFields");
    const key = "melete:take-columns:v1:" + (stationMode ? "station" : "practice");
    let preference, visible = [], widths, lastWidth = -1;
    function restore() {
      preference = "fit";
      try {
        const raw = JSON.parse(localStorage.getItem(key));
        if (raw === "fit" || raw === "all" || Array.isArray(raw)) preference = raw;
      } catch {}
    }
    function save(value) {
      preference = value;
      try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
      apply();
    }
    const checks = {};
    for (const [id, label] of Object.entries(fields)) {
      const input = document.createElement("input"), row = document.createElement("label");
      input.type = "checkbox"; checks[id] = input; row.append(input, label);
      menu.querySelector(".take-field-options").append(row);
      input.addEventListener("change", () => save(input.checked ? [...visible, id] : visible.filter(value => value !== id)));
    }
    function apply(measured = widths) {
      if (!measured) return;
      widths = measured;
      const named = find("#compView").classList.contains("has-singers");
      const style = getComputedStyle(table), room = table.clientWidth - widths.number - widths.hear - parseFloat(style.getPropertyValue("--take-actions-width")) - 1;
      const available = Object.keys(fields).filter(id => named || id !== "singer");
      const fitIdentity=named && preference==="fit" && room>=36+widths.part;
      const nameWidth=Math.min(widths.singer,Math.max(36,room-widths.part));
      if (fitIdentity) {
        // Keep the identity columns together; spend the remaining width on stats.
        const optional=visibleFields(available.filter(id=>id!=="singer" && id!=="part"),widths,room-nameWidth-widths.part,"fit");
        visible=available.filter(id=>id==="singer" || id==="part" || optional.includes(id));
      } else visible=visibleFields(available,widths,room,preference);
      for (const [id, check] of Object.entries(checks)) {
        check.parentElement.hidden = !available.includes(id); check.checked = visible.includes(id);
      }
      const view=find("#compView");
      if (fitIdentity) view.style.setProperty("--take-singer-width",nameWidth+"px");
      else view.style.removeProperty("--take-singer-width");
      const displayed = visible;
      const hidden = Object.keys(fields).filter(id => !displayed.includes(id)).join(" ");
      if (view.dataset.hiddenFields === hidden) return;
      const vars = ["number", ...displayed.filter(id => id !== "octave")].map(id => `var(--take-${id}-width)`);
      view.dataset.hiddenFields = hidden;
      view.style.setProperty("--take-value-columns", vars.join(" "));
      view.style.setProperty("--take-mean-left", "calc(" + vars.slice(0, vars.indexOf("var(--take-mean-width)")).join(" + ") + ")");
      view.style.setProperty("--take-value-width", "calc(" + vars.join(" + ") + ")");
      view.style.setProperty("--take-octave-slot", displayed.includes("octave") ? "var(--take-octave-width)" : "0px");
      view.style.setProperty("--take-table-width", "calc(var(--take-value-width) + var(--take-octave-slot) + var(--take-hear-width) + var(--take-actions-width))");
    }
    function positionMenu() {
      if (!menu.matches(":popover-open")) return;
      const box = trigger.getBoundingClientRect(), gap = 6;
      menu.style.maxHeight = (innerHeight - 2 * gap) + "px";
      menu.style.left = Math.max(gap, Math.min(innerWidth - menu.offsetWidth - gap, box.right - menu.offsetWidth)) + "px";
      const top = box.bottom + gap + menu.offsetHeight <= innerHeight ? box.bottom + gap : box.top - gap - menu.offsetHeight;
      menu.style.top = Math.max(gap, top) + "px";
    }
    restore(); layouts.set(table, apply);
    new ResizeObserver(() => {
      if (lastWidth !== table.clientWidth) { lastWidth = table.clientWidth; apply(); }
      positionMenu();
    }).observe(table);
    root.addEventListener("storage", e => { if (e.key === key || e.key === null) { restore(); apply(); } });
    find("#fitTakeFields").addEventListener("click", () => save("fit"));
    find("#allTakeFields").addEventListener("click", () => save("all"));
    menu.addEventListener("toggle", positionMenu);
    document.addEventListener("scroll", positionMenu, {capture:true, passive:true});
    function expanded(on) {
      panel.classList.toggle("is-table-expanded", on);
      expand.title = on ? "Collapse takes table" : "Expand takes table";
      expand.setAttribute("aria-label", expand.title); expand.setAttribute("aria-expanded", String(on));
    }
    new ResizeObserver(([entry]) => panel.style.setProperty("--take-content-height", Math.ceil(entry.contentRect.height) + "px")).observe(find(".take-review-content"));
    expand.addEventListener("click", () => expanded(expand.getAttribute("aria-expanded") !== "true"));
    panel.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !panel.classList.contains("is-table-expanded") || menu.matches(":popover-open") || find("#takeSingerDialog").open) return;
      event.preventDefault(); event.stopPropagation(); expanded(false); expand.focus({preventScroll:true});
    });
  }
  function deletionRow(row, label, restore, disabled) {
    let notice = row.querySelector(":scope > .take-undo");
    if (!label && !notice) return;
    row.classList.toggle("is-pending-delete", Boolean(label));
    if (!label) {
      const focused = notice.contains(document.activeElement);
      notice.remove();
      if (focused) row.querySelector(".take-delete")?.focus({preventScroll:true});
      return;
    }
    if (!notice) {
      const focused = row.contains(document.activeElement);
      notice = document.createElement("div");
      notice.className = "take-undo";
      const message = document.createElement("span");
      message.setAttribute("role", "status");
      const button = document.createElement("button");
      button.type = "button"; button.className = "take-command"; button.textContent = "Undo";
      notice.append(message, button);
      row.append(notice);
      if (focused && !disabled) button.focus({preventScroll:true});
    }
    const message = notice.firstElementChild, button = notice.lastElementChild;
    if (message.textContent !== label+" deleted") message.textContent = label+" deleted";
    button.setAttribute("aria-label", "Undo deletion of "+label);
    button.disabled = disabled;
    button.onclick = restore;
  }

  let canvas;
  function fitTable(container) {
    if (!container) return;
    compactDates(container);
    canvas ||= document.createElement("canvas");
    const context = canvas.getContext("2d");
    const aliases = {tracked: ".take-tracked, .comp-tracked", mean: ".take-error, .comp-mean",
      median: ".take-median, .comp-median", within: ".take-within, .comp-within",
      octave: ".take-octave, .take-octave-heading", hear: ".take-hear-heading"};
    const measured = {};
    for (const endpoint of ["number", ...Object.keys(fields), "hear"]) {
      let width = endpoint === "hear" ? 32 : 0;
      const cells = container.querySelectorAll(`${aliases[endpoint] || `.take-${endpoint}`}, [data-take-sort="${endpoint}"]`);
      for (const cell of cells) {
        const style = getComputedStyle(cell.querySelector("strong") || cell);
        // The font shorthand can be empty with tabular-nums and system fonts.
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const labels = endpoint === "octave" ? [cell.textContent, "-", "8va", "8vb"] : [cell.textContent];
        const padding = cell.classList.contains("take-metric") ? 30 : 10;
        for (const label of labels) width = Math.max(width, context.measureText(label).width + padding);
      }
      measured[endpoint] = Math.ceil(width);
      const value = `${measured[endpoint]}px`, key = `--take-${endpoint}-width`;
      if (container.style.getPropertyValue(key) !== value) container.style.setProperty(key, value);
    }
    layouts.get(container)?.(measured);
  }
  function confirmDeletes(container) {
    let armed = null, token = null, timer;
    function clear() {
      clearTimeout(timer);
      if (armed) {
        armed.classList.remove("is-delete-armed");
        if (armed.dataset.deleteLabel) armed.setAttribute("aria-label", armed.dataset.deleteLabel);
        if (armed.dataset.deleteTitle !== undefined) armed.title = armed.dataset.deleteTitle;
        delete armed.dataset.deleteLabel;
        delete armed.dataset.deleteTitle;
      }
      armed = null; token = null;
    }
    container.addEventListener("click", event => {
      const button = event.target.closest(".take-delete, #compCloudDelete");
      if (!button || button.disabled) { if (armed && !armed.contains(event.target)) clear(); return; }
      if (button === armed && token === button.dataset.deleteToken) { clear(); return; }
      clear(); armed = button; token = button.dataset.deleteToken;
      button.dataset.deleteLabel = button.getAttribute("aria-label") || "Delete";
      button.dataset.deleteTitle = button.title;
      button.setAttribute("aria-label", `Confirm ${button.dataset.deleteLabel.toLowerCase()}`);
      button.classList.add("is-delete-armed");
      button.title = "Click again to delete; Escape cancels";
      timer = setTimeout(clear, 6000);
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    container.addEventListener("keydown", event => {
      if (event.key === "Escape" && armed) { clear(); event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    root.addEventListener?.("blur", clear);
    return clear;
  }
  const signedCents = value => value > 0 ? "+" + value : String(value);
  function bucketLabel(cents) {
    const limit = root.MeleteTakePitch.DISTRIBUTION_LIMIT;
    if (cents < -limit) return "< −" + limit;
    if (cents > limit) return "> +" + limit;
    return signedCents(cents);
  }
  function distributionChart(svg, bins) {
    const node = (tag, attributes, label) => {
      const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
      if (label !== undefined) element.textContent = label;
      svg.append(element);
      return element;
    };
    const limit = root.MeleteTakePitch.DISTRIBUTION_LIMIT;
    const first = bins[0].cents, last = bins.at(-1).cents;
    const low = Math.max(-limit, Math.min(-1, first)), high = Math.min(limit, Math.max(1, last));
    // Separate the categorical tails from the linear, one-cent axis.
    const left = first < -limit ? 63 : 44, right = last > limit ? 577 : 608;
    const peak = Math.max(...bins.map(b => b.samples)), width = (right-left) / (high-low+1);
    function x(cents) {
      if (cents < -limit) return 22;
      if (cents > limit) return 618;
      return left + (cents - low + .5) * width;
    }
    const y = samples => 132 - 108 * samples / peak;
    svg.replaceChildren();
    node("line", {class:"axis", x1:left, x2:right, y1:132, y2:132});
    node("line", {class:"axis", x1:x(0), x2:x(0), y1:22, y2:132, "stroke-dasharray":"3 3"});
    node("text", {x:44,y:14}, peak + (peak === 1 ? " measurement" : " measurements"));
    const count = high - low;
    const step = [1,2,5,10,20,25,50].find(value => count / value <= 8);
    for (let tick = Math.ceil(low / step) * step; tick <= high; tick += step)
      node("text", {x:x(tick),y:149,"text-anchor":"middle"}, signedCents(tick));
    node("text", {x:326,y:170,"text-anchor":"middle"}, "Flat (−)     ·     Error in cents     ·     Sharp (+)");
    for (const {cents, samples} of bins) {
      const label = bucketLabel(cents);
      if (Math.abs(cents) > limit) {
        node("line", {class:"axis", x1:x(cents)-8, x2:x(cents)+8, y1:132, y2:132});
        node("text", {x:x(cents),y:149,"text-anchor":"middle"}, label);
      }
      const bar = node("rect", {class:"bars", x:x(cents)-width/2, y:y(samples), width, height:132-y(samples)});
      const tip = document.createElementNS(svg.namespaceURI, "title");
      tip.textContent = label + " ¢ · " + samples + (samples === 1 ? " measurement" : " measurements");
      bar.append(tip);
    }
  }
  async function openDistribution(label, load) {
    const dialog = document.getElementById("takeDistributionDialog"), svg = dialog.querySelector("svg");
    const details = dialog.querySelector("details"), status = dialog.querySelector(".distribution-status");
    const token = String(Number(dialog.dataset.request || 0) + 1);
    dialog.dataset.request = token;
    dialog.querySelector(".distribution-take").textContent = label;
    status.textContent = "Loading pitch measurements…";
    svg.setAttribute("hidden", ""); details.hidden = true; details.open = false;
    if (!dialog.open) dialog.showModal();
    try {
      const data = await load();
      if (!dialog.open || dialog.dataset.request !== token) return;
      if (!data?.frames || !data.ref) { status.textContent = "No saved pitch contour is available for this take."; return; }
      const {bins, samples, seconds} = root.MeleteTakePitch.errorDistribution(data.frames, data.ref);
      if (!samples) { status.textContent = "No pitch measurements overlap written notes in this take."; return; }
      status.textContent = `${samples.toLocaleString()} on-note measurements · ${seconds.toFixed(2)} s measured`;
      distributionChart(svg, bins); svg.removeAttribute("hidden");
      const body = dialog.querySelector("tbody");
      body.replaceChildren(...bins.map(bin => {
        const row = document.createElement("tr");
        for (const value of [bucketLabel(bin.cents), bin.samples, bin.seconds.toFixed(3)]) row.insertCell().textContent = value;
        return row;
      }));
      details.hidden = false;
    } catch (error) {
      if (dialog.open && dialog.dataset.request === token) status.textContent = error.message || "Pitch measurements are unavailable.";
    }
  }
  function distributionButton(row, label, load) {
    const button = row.querySelector(".take-distribution");
    button.hidden = !load;
    button.title = "View one-cent intonation distribution for " + label;
    button.setAttribute("aria-label", button.title);
    button.onclick = load ? () => { void openDistribution(label, load); } : null;
  }
  const api = {dates, trackDates, showDates, formatDate, compactDates, fitTable, confirmDeletes, deletionRow, distributionButton,
    metricLabels, metricValues, metricDeltas, tablePreferences, visibleFields};
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteTakeControls = api;
})(globalThis);
