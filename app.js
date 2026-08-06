const STORAGE_KEY = "airfoilAtlasProjectV1";
const CATALOG_CACHE_KEY = "airfoilAtlasCatalogV3";
const GEOMETRY_PREFIX = "airfoilAtlasGeometry:";
const UIUC_GITHUB_TREE = "https://api.github.com/repos/vrona/Airfoil-DNA/git/trees/master?recursive=1";
const UIUC_RAW_ROOT = "https://raw.githubusercontent.com/vrona/Airfoil-DNA/master/coord_seligFmt/";
const UIUC_OFFICIAL = "https://m-selig.ae.illinois.edu/ads/coord_database.html";
const AIRFOILTOOLS_DETAILS = "https://airfoiltools.com/airfoil/details?airfoil=";

const DEFAULT_PROJECT = {
  name: "30 m/s drone",
  speed: 30,
  chord: 0.30,
  altitude: 0,
  temperature: 15,
  targetCl: ""
};

const DEFAULT_FILTERS = {
  mission: "general",
  family: "any",
  thicknessMin: "",
  thicknessMax: "",
  camberMax: "",
  symmetric: false,
  measured: false,
  roughness: false,
  search: "",
  sort: "relevance-desc",
  pageSize: 100
};

const state = {
  catalog: [],
  filtered: [],
  user: loadUserData(),
  filters: { ...DEFAULT_FILTERS },
  view: location.hash.replace("#", "") || "airfoils",
  page: 1,
  cardView: false,
  activeDetailId: null,
  loadingCatalog: false
};

const els = Object.fromEntries([
  "wantCount","triedCount","compareCount","viewTitle","viewDescription","operatingSummary",
  "catalogView","compareView","missionFilter","familyFilter","thicknessMin","thicknessMax",
  "camberMax","symmetricPreference","measuredPreference","roughnessPreference","catalogStatus",
  "refreshCatalog","searchInput","sortSelect","pageSizeSelect","viewToggle","resultCount",
  "rankingExplanation","airfoilTableWrap","airfoilRows","airfoilCards","prevPage","nextPage","pageInfo","pagination",
  "resetFilters","detailDialog","detailContent","projectDialog","projectButton","projectForm",
  "projectName","projectSpeed","projectChord","projectAltitude","projectTemperature","projectCl",
  "projectCalculated","projectReset","dataDialog","dataButton","exportData","importData",
  "exportCatalogCsv","clearData","clearCompare","compareEmpty","compareContent","compareCanvas",
  "compareTableWrap"
].map(id => [id, document.getElementById(id)]));

init();

async function init() {
  bindEvents();
  syncFilterControls();
  populateProjectForm();
  updateCalculatedProject();
  updateOperatingSummary();
  await loadBundledCatalog();
  const cached = loadCatalogCache();
  if (cached.length) {
    mergeCatalog(cached);
    setCatalogStatus(`${state.catalog.length.toLocaleString()} catalog entries loaded from browser cache.`);
  }
  normalizeView();
  renderAll();
  discoverFullCatalog(false);
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
  [els.missionFilter, els.familyFilter, els.thicknessMin, els.thicknessMax, els.camberMax,
   els.symmetricPreference, els.measuredPreference, els.roughnessPreference, els.sortSelect,
   els.pageSizeSelect].forEach(control => control.addEventListener("change", onFilterChange));
  els.searchInput.addEventListener("input", debounce(onFilterChange, 120));
  els.resetFilters.addEventListener("click", () => {
    state.filters = { ...DEFAULT_FILTERS };
    state.page = 1;
    syncFilterControls();
    renderAll();
  });
  els.prevPage.addEventListener("click", () => { state.page = Math.max(1, state.page - 1); renderCatalog(); scrollCatalogTop(); });
  els.nextPage.addEventListener("click", () => { state.page += 1; renderCatalog(); scrollCatalogTop(); });
  els.viewToggle.addEventListener("click", () => { state.cardView = !state.cardView; els.viewToggle.textContent = state.cardView ? "Table" : "Cards"; renderCatalog(); });
  els.refreshCatalog.addEventListener("click", () => discoverFullCatalog(true));
  els.projectButton.addEventListener("click", () => { populateProjectForm(); updateCalculatedProject(); els.projectDialog.showModal(); });
  [els.projectSpeed, els.projectChord, els.projectAltitude, els.projectTemperature].forEach(input => input.addEventListener("input", updateCalculatedProject));
  els.projectReset.addEventListener("click", () => { setProjectForm(DEFAULT_PROJECT); updateCalculatedProject(); });
  els.projectForm.addEventListener("submit", event => {
    event.preventDefault();
    state.user.project = readProjectForm();
    saveUserData();
    els.projectDialog.close();
    updateOperatingSummary();
    renderAll();
  });
  els.dataButton.addEventListener("click", () => els.dataDialog.showModal());
  els.exportData.addEventListener("click", exportProjectData);
  els.importData.addEventListener("change", importProjectData);
  els.exportCatalogCsv.addEventListener("click", exportCatalogCsv);
  els.clearData.addEventListener("click", clearProjectData);
  els.clearCompare.addEventListener("click", () => { state.user.compare = []; saveUserData(); renderAll(); });
  els.airfoilRows.addEventListener("click", handleCatalogClick);
  els.airfoilRows.addEventListener("change", handleCatalogChange);
  els.airfoilCards.addEventListener("click", handleCatalogClick);
  els.airfoilCards.addEventListener("change", handleCatalogChange);
  els.detailContent.addEventListener("click", handleDetailClick);
  els.detailContent.addEventListener("input", handleDetailInput);
  els.detailContent.addEventListener("submit", handleDetailSubmit);
  window.addEventListener("hashchange", () => { state.view = location.hash.replace("#", "") || "airfoils"; normalizeView(); renderAll(); });
  window.addEventListener("resize", debounce(() => {
    if (state.activeDetailId) redrawActiveGeometry();
    if (state.view === "compare") renderCompare();
  }, 180));
}

async function loadBundledCatalog() {
  try {
    const response = await fetch("data/airfoils.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    mergeCatalog(data.airfoils || data);
    setCatalogStatus(`${state.catalog.length.toLocaleString()} bundled entries loaded; checking full source index…`);
  } catch (error) {
    console.error(error);
    setCatalogStatus("Bundled catalog could not be loaded. Serve this folder through a web server rather than opening index.html directly.");
  }
}

async function discoverFullCatalog(force = false) {
  if (state.loadingCatalog || (!force && loadCatalogCache().length)) return;
  state.loadingCatalog = true;
  els.refreshCatalog.disabled = true;
  els.refreshCatalog.textContent = "Refreshing…";
  setCatalogStatus("Reading the full UIUC-compatible coordinate index…");
  try {
    const response = await fetch(UIUC_GITHUB_TREE, {
      headers: { "Accept": "application/vnd.github+json" },
      cache: force ? "reload" : "default"
    });
    if (!response.ok) throw new Error(`Catalog source returned ${response.status}`);
    const payload = await response.json();
    const files = (payload.tree || []).filter(item => item.type === "blob" && /^coord_seligFmt\/.*\.dat$/i.test(item.path));
    const imported = files.map(item => {
      const filename = item.path.split("/").pop();
      return createCatalogEntry(filename.replace(/\.dat$/i, ""), filename, "UIUC coordinate mirror");
    });
    mergeCatalog(imported);
    saveCatalogCache(imported);
    setCatalogStatus(`${state.catalog.length.toLocaleString()} entries indexed. Geometry is loaded and measured when an entry is opened.`);
    renderAll();
  } catch (error) {
    console.warn(error);
    setCatalogStatus(`${state.catalog.length.toLocaleString()} bundled/cached entries available. Full online refresh failed: ${error.message}.`);
  } finally {
    state.loadingCatalog = false;
    els.refreshCatalog.disabled = false;
    els.refreshCatalog.textContent = "Refresh full catalog";
  }
}

function createCatalogEntry(id, filename = `${id}.dat`, source = "UIUC") {
  const inferred = inferFromIdentifier(id);
  return normalizeAirfoil({
    id,
    filename,
    name: inferred.name,
    family: inferred.family,
    thickness: inferred.thickness,
    camber: inferred.camber,
    camberPosition: inferred.camberPosition,
    symmetric: inferred.symmetric,
    reflexed: inferred.reflexed,
    recommendedRe: inferred.recommendedRe,
    speedClass: inferred.speedClass,
    altitudeClass: inferred.altitudeClass,
    useCases: inferred.useCases,
    traits: inferred.traits,
    evidence: inferred.evidence,
    classificationConfidence: inferred.classificationConfidence,
    geometrySource: source,
    coordinateUrl: `${UIUC_RAW_ROOT}${encodeURIComponent(filename)}`,
    officialSourceUrl: `${UIUC_OFFICIAL}#${encodeURIComponent(inferred.name.charAt(0).toUpperCase())}`,
    specificationUrl: `${AIRFOILTOOLS_DETAILS}${encodeURIComponent(id)}-il`
  });
}

function normalizeAirfoil(raw) {
  const inferred = inferFromIdentifier(raw.id || raw.filename || raw.name || "unknown");
  const foil = {
    id: String(raw.id || slugify(raw.name)),
    filename: raw.filename || `${raw.id || slugify(raw.name)}.dat`,
    name: raw.name || inferred.name,
    family: raw.family || inferred.family,
    thickness: finiteOrNull(raw.thickness ?? inferred.thickness),
    thicknessPosition: finiteOrNull(raw.thicknessPosition),
    camber: finiteOrNull(raw.camber ?? inferred.camber),
    camberPosition: finiteOrNull(raw.camberPosition ?? inferred.camberPosition),
    trailingEdgeThickness: finiteOrNull(raw.trailingEdgeThickness),
    symmetric: typeof raw.symmetric === "boolean" ? raw.symmetric : inferred.symmetric,
    reflexed: typeof raw.reflexed === "boolean" ? raw.reflexed : inferred.reflexed,
    recommendedRe: validRange(raw.recommendedRe) || inferred.recommendedRe,
    recommendedMach: validRange(raw.recommendedMach) || inferred.recommendedMach,
    speedClass: raw.speedClass || inferred.speedClass,
    altitudeClass: raw.altitudeClass || inferred.altitudeClass,
    useCases: unique([...(raw.useCases || []), ...(inferred.useCases || [])]),
    traits: unique([...(raw.traits || []), ...(inferred.traits || [])]),
    evidence: raw.evidence || inferred.evidence,
    classificationConfidence: raw.classificationConfidence || inferred.classificationConfidence,
    geometrySource: raw.geometrySource || "Catalog geometry",
    coordinateUrl: raw.coordinateUrl || `${UIUC_RAW_ROOT}${encodeURIComponent(raw.filename || `${raw.id}.dat`)}`,
    officialSourceUrl: raw.officialSourceUrl || UIUC_OFFICIAL,
    specificationUrl: raw.specificationUrl || `${AIRFOILTOOLS_DETAILS}${encodeURIComponent(raw.id || slugify(raw.name || inferred.name))}-il`,
    polarUrl: raw.polarUrl || null,
    description: raw.description || null,
    coordinates: raw.coordinates || null
  };
  return foil;
}

function mergeCatalog(entries) {
  const map = new Map(state.catalog.map(item => [item.id.toLowerCase(), item]));
  for (const entry of entries || []) {
    const normalized = normalizeAirfoil(entry);
    const key = normalized.id.toLowerCase();
    const existing = map.get(key);
    if (!existing) map.set(key, normalized);
    else map.set(key, mergeAirfoil(existing, normalized));
  }
  state.catalog = [...map.values()].sort((a,b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  populateFamilies();
}

function mergeAirfoil(a, b) {
  const choose = (x, y) => x !== null && x !== undefined && x !== "" ? x : y;
  return {
    ...b,
    ...a,
    name: choose(a.name, b.name),
    family: choose(a.family, b.family),
    thickness: choose(a.thickness, b.thickness),
    thicknessPosition: choose(a.thicknessPosition, b.thicknessPosition),
    camber: choose(a.camber, b.camber),
    camberPosition: choose(a.camberPosition, b.camberPosition),
    symmetric: typeof a.symmetric === "boolean" ? a.symmetric : b.symmetric,
    useCases: unique([...(a.useCases || []), ...(b.useCases || [])]),
    traits: unique([...(a.traits || []), ...(b.traits || [])]),
    coordinates: a.coordinates || b.coordinates
  };
}

function inferFromIdentifier(identifier) {
  const raw = String(identifier).replace(/\.dat$/i, "").trim();
  const compact = raw.toLowerCase().replace(/[\s_\-()]/g, "");
  let name = humanizeAirfoilName(raw);
  let family = "Other / historical";
  let thickness = null;
  let camber = null;
  let camberPosition = null;
  let symmetric = null;
  let reflexed = false;
  let recommendedRe = [250000, 3000000];
  let recommendedMach = [0, 0.30];
  let speedClass = "Subsonic / application dependent";
  let altitudeClass = "Altitude depends on Reynolds number";
  let useCases = ["General comparison"];
  let traits = [];
  let evidence = "Geometry source; aerodynamic evidence varies";
  let classificationConfidence = "heuristic";

  let match = compact.match(/^naca(\d)(\d)(\d{2})$/);
  if (match) {
    family = "NACA 4-digit";
    camber = Number(match[1]);
    camberPosition = Number(match[2]) * 10;
    thickness = Number(match[3]);
    symmetric = camber === 0;
    name = `NACA ${match[1]}${match[2]}${match[3]}`;
    recommendedRe = symmetric ? [200000, 8000000] : [300000, 8000000];
    useCases = symmetric ? ["Stabilizer", "Aerobatic wing", "Bidirectional loading"] : ["General aircraft wing", "Trainer", "UAV"];
    traits = symmetric ? ["Symmetric", "Predictable", "Broadly documented"] : ["Conventional camber", "Broadly documented"];
    evidence = "Analytical NACA geometry; extensive historical data for many sections";
    classificationConfidence = "high";
  } else if (/^naca(23|24|25)\d{3}/.test(compact)) {
    family = "NACA 5-digit";
    const digits = compact.replace("naca", "");
    thickness = Number(digits.slice(-2));
    symmetric = false;
    reflexed = digits[2] === "1";
    name = `NACA ${digits}`;
    recommendedRe = [500000, 10000000];
    useCases = ["General aircraft wing", reflexed ? "Low pitching-moment wing" : "Higher design lift"];
    traits = [reflexed ? "Reflexed camber" : "Designed lift coefficient", "Historical test data"];
    classificationConfidence = "medium";
  } else if (/^naca6/.test(compact) || /^naca(63|64|65|66|67)/.test(compact)) {
    family = "NACA 6-series";
    const t = compact.match(/(\d{2})$/);
    thickness = t ? Number(t[1]) : null;
    symmetric = false;
    recommendedRe = [1000000, 15000000];
    recommendedMach = [0.10, 0.70];
    speedClass = "Efficient subsonic / laminar-flow design";
    useCases = ["Efficient cruise", "Laminar-flow wing"];
    traits = ["Narrow low-drag bucket", "Surface-finish sensitive"];
    classificationConfidence = "medium";
  } else if (/^(sc|nasasc|sc2)/.test(compact)) {
    family = "NASA supercritical";
    const t = compact.match(/(\d{2})$/);
    thickness = t ? Number(t[1]) : null;
    recommendedRe = [3000000, 30000000];
    recommendedMach = [0.55, 0.82];
    speedClass = "High subsonic / transonic";
    altitudeClass = "Transport-aircraft operating regimes";
    useCases = ["High-subsonic cruise", "Transonic wing"];
    traits = ["Supercritical", "Not optimized for a 30 m/s UAV"];
    classificationConfidence = "medium";
  } else if (/^rae/.test(compact)) {
    family = "RAE";
    recommendedRe = [1000000, 20000000];
    recommendedMach = [0.25, 0.80];
    speedClass = "Moderate to transonic, section dependent";
    useCases = ["Research benchmark", "High-speed aircraft"];
    traits = ["Published benchmark data for selected sections"];
  } else if (/^clark/.test(compact)) {
    family = "Clark";
    recommendedRe = [150000, 5000000];
    useCases = ["Low-speed wing", "Trainer", "UAV"];
    traits = ["Simple construction", "Forgiving", "Flat-ish lower surface"];
    evidence = "Historical geometry and test data available for common variants";
  } else if (/^ag\d/.test(compact)) {
    family = "Drela AG";
    recommendedRe = [50000, 700000];
    speedClass = "Low speed / low Reynolds number";
    altitudeClass = "Small UAV and model-aircraft regimes";
    useCases = ["Low-Re UAV", "Glider", "Endurance"];
    traits = ["Low-Re design", "Smooth-surface performance emphasis"];
    evidence = "UIUC low-speed program includes several AG sections";
  } else if (/^sd\d/.test(compact)) {
    family = "Selig/Donovan (SD)";
    recommendedRe = [60000, 1000000];
    speedClass = "Low speed / low Reynolds number";
    useCases = ["UAV", "Model aircraft", "Glider"];
    traits = ["Low-Re design", "Common model-aircraft family"];
  } else if (/^s\d{3,4}/.test(compact)) {
    family = "Selig / NREL S-series";
    recommendedRe = [80000, 1500000];
    speedClass = "Low-speed, section dependent";
    useCases = ["UAV", "Wind turbine", "High lift"];
    traits = [/^s12/.test(compact) ? "Very high lift" : "Low-Re design", "Wind-tunnel data available for selected sections"];
    evidence = "Selected S-series sections have UIUC/NREL wind-tunnel data";
  } else if (/^e\d{2,4}/.test(compact) || /^eppler/.test(compact)) {
    family = "Eppler";
    recommendedRe = [60000, 1500000];
    speedClass = "Low to moderate speed";
    useCases = ["Glider", "UAV", "Efficient cruise"];
    traits = ["Low-Re family", "Section-specific sensitivity"];
  } else if (/^fx/.test(compact)) {
    family = "Wortmann FX";
    recommendedRe = [80000, 2500000];
    speedClass = "Low to moderate speed";
    useCases = ["Glider", "UAV", "Sailplane"];
    traits = ["Laminar-flow intent", "Surface-finish sensitive"];
  } else if (/^mh/.test(compact)) {
    family = "Martin Hepperle (MH)";
    recommendedRe = [50000, 1500000];
    speedClass = "Low speed / model aircraft";
    useCases = ["UAV", "Model aircraft", "Propeller or wing, section dependent"];
    traits = ["Low-Re family"];
  } else if (/^rg/.test(compact)) {
    family = "Ritz / Göppingen RG";
    recommendedRe = [60000, 1200000];
    useCases = ["Glider", "Model aircraft", "UAV"];
    traits = ["Low-Re family"];
  } else if (/^du/.test(compact)) {
    family = "Delft DU";
    recommendedRe = [1000000, 20000000];
    useCases = ["Wind turbine", "High-Re wing"];
    traits = ["Wind-turbine family", "Often relatively thick"];
  } else if (/^(ffa|oso)/.test(compact)) {
    family = compact.startsWith("ffa") ? "FFA" : "OSO";
    recommendedRe = [2500000, 20000000];
    useCases = ["Wind turbine"];
    traits = ["Thick structural section", "High Reynolds number"];
  } else if (/^goe|^gottingen/.test(compact)) {
    family = "Göttingen";
    recommendedRe = [200000, 5000000];
    useCases = ["Historical aircraft", "General research"];
    traits = ["Historical section"];
  } else if (/^raf/.test(compact)) {
    family = "RAF";
    recommendedRe = [500000, 8000000];
    useCases = ["Historical aircraft", "General research"];
    traits = ["Historical section"];
  } else if (/^(nlf|ls)/.test(compact)) {
    family = compact.startsWith("nlf") ? "NASA NLF" : "NASA LS";
    recommendedRe = [500000, 10000000];
    useCases = [compact.startsWith("nlf") ? "Natural laminar flow" : "Low-speed aircraft", "Efficient cruise"];
    traits = [compact.startsWith("nlf") ? "Laminar-flow intent" : "Low-speed design"];
  } else if (/^(hq|hqu)/.test(compact)) {
    family = "HQ";
    recommendedRe = [80000, 1500000];
    useCases = ["Glider", "Model aircraft"];
    traits = ["Low-Re family"];
  }

  return { name, family, thickness, camber, camberPosition, symmetric, reflexed,
    recommendedRe, recommendedMach, speedClass, altitudeClass, useCases, traits,
    evidence, classificationConfidence };
}

function humanizeAirfoilName(id) {
  const clean = String(id).replace(/\.dat$/i, "").replace(/_/g, "-");
  const naca = clean.match(/^naca([0-9a-z()-]+)$/i);
  if (naca) return `NACA ${naca[1].toUpperCase()}`;
  if (/^clarky$/i.test(clean)) return "Clark Y";
  if (/^e\d+$/i.test(clean)) return clean.toUpperCase().replace(/^E/, "Eppler E");
  return clean.replace(/([a-z])([0-9])/gi, "$1 $2").replace(/([0-9])([a-z])/gi, "$1 $2").replace(/\b[a-z]/g, m => m.toUpperCase());
}

function onFilterChange() {
  state.filters = {
    mission: els.missionFilter.value,
    family: els.familyFilter.value,
    thicknessMin: els.thicknessMin.value,
    thicknessMax: els.thicknessMax.value,
    camberMax: els.camberMax.value,
    symmetric: els.symmetricPreference.checked,
    measured: els.measuredPreference.checked,
    roughness: els.roughnessPreference.checked,
    search: els.searchInput.value,
    sort: els.sortSelect.value,
    pageSize: Number(els.pageSizeSelect.value)
  };
  state.page = 1;
  renderAll();
}

function syncFilterControls() {
  els.missionFilter.value = state.filters.mission;
  els.familyFilter.value = state.filters.family;
  els.thicknessMin.value = state.filters.thicknessMin;
  els.thicknessMax.value = state.filters.thicknessMax;
  els.camberMax.value = state.filters.camberMax;
  els.symmetricPreference.checked = state.filters.symmetric;
  els.measuredPreference.checked = state.filters.measured;
  els.roughnessPreference.checked = state.filters.roughness;
  els.searchInput.value = state.filters.search;
  els.sortSelect.value = state.filters.sort;
  els.pageSizeSelect.value = String(state.filters.pageSize);
}

function populateFamilies() {
  const current = state.filters.family;
  const families = [...new Set(state.catalog.map(f => f.family).filter(Boolean))].sort();
  els.familyFilter.innerHTML = `<option value="any">Any family</option>${families.map(f => `<option value="${escapeAttr(f)}">${escapeHtml(f)}</option>`).join("")}`;
  els.familyFilter.value = families.includes(current) ? current : "any";
  if (!families.includes(current)) state.filters.family = "any";
}

function renderAll() {
  normalizeView();
  updateCounts();
  updateViewHeader();
  updateOperatingSummary();
  document.querySelectorAll("[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === state.view));
  els.catalogView.hidden = state.view === "compare";
  els.compareView.hidden = state.view !== "compare";
  if (state.view === "compare") renderCompare();
  else renderCatalog();
}

function normalizeView() {
  const allowed = ["airfoils","stabilizers","want","tried","compare"];
  if (!allowed.includes(state.view)) state.view = "airfoils";
}

function setView(view) {
  state.view = view;
  state.page = 1;
  if (location.hash !== `#${view}`) history.pushState(null, "", `#${view}`);
  renderAll();
}

function updateViewHeader() {
  const data = {
    airfoils: ["Wing airfoils", "Rank every catalog entry against your aircraft’s operating point. Preference filters change relevance colors and ordering; they do not remove candidates."],
    stabilizers: ["Horizontal stabilizer foils", "The same catalog, ranked for tail use: low camber, suitable thickness, predictable moment behavior, and Reynolds-number compatibility receive priority."],
    want: ["Want to try", "Your project shortlist. Statuses and notes are stored locally and included in project exports."],
    tried: ["Tried", "Airfoils your group has tested, with access to real-world records and notes."],
    compare: ["Airfoil comparison", "Overlay normalized geometry and compare project relevance, operating ranges, and evidence."],
  }[state.view];
  els.viewTitle.textContent = data[0];
  els.viewDescription.textContent = data[1];
}

function updateCounts() {
  const statuses = state.user.statuses || {};
  els.wantCount.textContent = Object.values(statuses).filter(v => v === "want").length;
  els.triedCount.textContent = Object.values(statuses).filter(v => v === "tried").length;
  els.compareCount.textContent = state.user.compare.length;
}

function renderCatalog() {
  const mode = state.view === "stabilizers" ? "stabilizer" : "wing";
  const search = state.filters.search.trim().toLowerCase();
  let items = state.catalog.map(foil => ({ foil, score: scoreAirfoil(foil, mode) }));

  if (state.view === "want") items = items.filter(item => state.user.statuses[item.foil.id] === "want");
  if (state.view === "tried") items = items.filter(item => state.user.statuses[item.foil.id] === "tried");
  if (search) items = items.filter(({foil}) => [foil.name, foil.id, foil.family, ...(foil.useCases || []), ...(foil.traits || [])].join(" ").toLowerCase().includes(search));

  items.sort(sortFunction(state.filters.sort));
  state.filtered = items;
  const totalPages = Math.max(1, Math.ceil(items.length / state.filters.pageSize));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * state.filters.pageSize;
  const pageItems = items.slice(start, start + state.filters.pageSize);

  els.resultCount.textContent = `${items.length.toLocaleString()} airfoil${items.length === 1 ? "" : "s"}`;
  els.rankingExplanation.textContent = mode === "stabilizer"
    ? "All candidates remain visible; colors rank tail-section suitability."
    : `All candidates remain visible; colors rank the current Re ≈ ${formatNumber(operatingPoint().re, 3)} operating point.`;
  els.pageInfo.textContent = `Page ${state.page} of ${totalPages}`;
  els.prevPage.disabled = state.page <= 1;
  els.nextPage.disabled = state.page >= totalPages;
  els.pagination.hidden = items.length <= state.filters.pageSize;

  els.airfoilTableWrap.hidden = state.cardView;
  els.airfoilCards.hidden = !state.cardView;
  if (state.cardView) renderCards(pageItems);
  else renderRows(pageItems);
}

function renderRows(items) {
  els.airfoilRows.innerHTML = items.map(({foil, score}) => {
    const status = state.user.statuses[foil.id] || "none";
    const scoreColor = scoreColorFor(score.total);
    const geometry = geometrySummary(foil);
    return `<tr style="--row-score:${scoreColor}">
      <td><span class="score-pill" style="--score-color:${scoreColor}" title="${escapeAttr(score.summary)}"><i></i>${Math.round(score.total)}</span></td>
      <td><button class="airfoil-name-button" data-action="details" data-id="${escapeAttr(foil.id)}">${escapeHtml(foil.name)}</button><div class="airfoil-id">${escapeHtml(foil.id)}</div></td>
      <td><span class="tag">${escapeHtml(foil.family)}</span></td>
      <td><div class="metric-inline"><strong>${geometry}</strong><span>${foil.symmetric === true ? "symmetric" : foil.symmetric === false ? "cambered" : "symmetry unknown"}</span></div></td>
      <td><div class="tag-list">${foil.useCases.slice(0,2).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div></td>
      <td><div class="evidence"><strong>${escapeHtml(evidenceLabel(foil))}</strong><small>${escapeHtml(foil.classificationConfidence)} classification</small></div></td>
      <td><div class="project-actions">
        <button class="icon-button ${status === "want" ? "active-want" : ""}" data-action="status" data-status="want" data-id="${escapeAttr(foil.id)}">Try</button>
        <button class="icon-button ${status === "tried" ? "active-tried" : ""}" data-action="status" data-status="tried" data-id="${escapeAttr(foil.id)}">Tried</button>
        <label title="Add to comparison"><input class="compare-check" type="checkbox" data-action="compare" data-id="${escapeAttr(foil.id)}" ${state.user.compare.includes(foil.id) ? "checked" : ""}></label>
      </div></td>
    </tr>`;
  }).join("") || `<tr><td colspan="7"><div class="empty-state">No entries match the name search or collection.</div></td></tr>`;
}

function renderCards(items) {
  els.airfoilCards.innerHTML = items.map(({foil, score}) => {
    const status = state.user.statuses[foil.id] || "none";
    const scoreColor = scoreColorFor(score.total);
    return `<article class="airfoil-card" style="--score-color:${scoreColor}">
      <div class="airfoil-card-head"><div><button class="airfoil-name-button" data-action="details" data-id="${escapeAttr(foil.id)}"><h3>${escapeHtml(foil.name)}</h3></button><div class="airfoil-id">${escapeHtml(foil.family)}</div></div><span class="score-pill" style="--score-color:${scoreColor}"><i></i>${Math.round(score.total)}</span></div>
      <div class="card-metrics"><div class="card-metric"><span>Thickness</span><strong>${formatPercent(foil.thickness)}</strong></div><div class="card-metric"><span>Camber</span><strong>${formatPercent(foil.camber)}</strong></div><div class="card-metric"><span>Re range</span><strong>${formatRange(foil.recommendedRe)}</strong></div></div>
      <div class="tag-list">${foil.useCases.slice(0,3).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
      <div class="project-actions"><button class="icon-button ${status === "want" ? "active-want" : ""}" data-action="status" data-status="want" data-id="${escapeAttr(foil.id)}">Want to try</button><button class="icon-button ${status === "tried" ? "active-tried" : ""}" data-action="status" data-status="tried" data-id="${escapeAttr(foil.id)}">Tried</button><label class="check-row"><input class="compare-check" type="checkbox" data-action="compare" data-id="${escapeAttr(foil.id)}" ${state.user.compare.includes(foil.id) ? "checked" : ""}><span>Compare</span></label></div>
    </article>`;
  }).join("") || `<div class="empty-state">No entries match the name search or collection.</div>`;
}

function sortFunction(sort) {
  const numeric = key => (a,b) => nullableNumber(a.foil[key], sort.endsWith("desc") ? -Infinity : Infinity) - nullableNumber(b.foil[key], sort.endsWith("desc") ? -Infinity : Infinity);
  switch (sort) {
    case "name-asc": return (a,b) => a.foil.name.localeCompare(b.foil.name, undefined, {numeric:true});
    case "name-desc": return (a,b) => b.foil.name.localeCompare(a.foil.name, undefined, {numeric:true});
    case "thickness-desc": return (a,b) => nullableNumber(b.foil.thickness, -Infinity) - nullableNumber(a.foil.thickness, -Infinity);
    case "thickness-asc": return numeric("thickness");
    case "camber-desc": return (a,b) => nullableNumber(b.foil.camber, -Infinity) - nullableNumber(a.foil.camber, -Infinity);
    case "family-asc": return (a,b) => a.foil.family.localeCompare(b.foil.family) || a.foil.name.localeCompare(b.foil.name);
    case "status": return (a,b) => statusRank(state.user.statuses[b.foil.id]) - statusRank(state.user.statuses[a.foil.id]) || b.score.total-a.score.total;
    default: return (a,b) => b.score.total - a.score.total || a.foil.name.localeCompare(b.foil.name, undefined, {numeric:true});
  }
}

function scoreAirfoil(foil, mode = "wing") {
  const op = operatingPoint();
  const components = {};
  components.reynolds = rangeScore(op.re, foil.recommendedRe) * 35;
  components.mach = rangeScore(op.mach, foil.recommendedMach || [0, .3]) * 10;
  components.mission = missionScore(foil, state.filters.mission) * 20;
  components.geometry = geometryPreferenceScore(foil, mode) * 25;
  components.evidence = evidenceScore(foil) * 10;

  let total = Object.values(components).reduce((sum, n) => sum+n, 0);
  if (state.filters.family !== "any") total += foil.family === state.filters.family ? 8 : -5;
  if (state.filters.measured) total += evidenceScore(foil) * 5 - 2;
  if (state.filters.roughness || state.filters.mission === "roughness") {
    const laminar = foil.traits.some(t => /laminar|surface-finish/i.test(t));
    const tolerant = foil.traits.some(t => /roughness|forgiving|predictable/i.test(t));
    total += tolerant ? 7 : laminar ? -10 : 0;
  }
  total = clamp(total, 0, 100);
  const best = Object.entries(components).sort((a,b)=>b[1]-a[1])[0];
  const worst = Object.entries(components).sort((a,b)=>a[1]-b[1])[0];
  return {
    total,
    components,
    summary: `Strongest factor: ${best[0]}. Weakest/unknown factor: ${worst[0]}. Ranking is heuristic until matched polar or test data are available.`
  };
}

function geometryPreferenceScore(foil, mode) {
  let score = .62;
  const t = foil.thickness;
  const c = foil.camber;
  if (mode === "stabilizer") {
    score = foil.symmetric === true ? 1 : foil.symmetric === false ? .35 : .58;
    if (c !== null) score = (score + clamp(1 - c / 4, 0, 1)) / 2;
    if (t !== null) score = (score + bellScore(t, 10, 6)) / 2;
  } else {
    if (t !== null) score = .72;
    if (state.filters.mission === "high-lift" || state.filters.mission === "payload") {
      score = c !== null ? clamp(.45 + c/10, .35, 1) : .58;
    } else if (state.filters.mission === "endurance") {
      score = foil.traits.some(x => /laminar|low-re|efficient/i.test(x)) ? .92 : .57;
    } else if (state.filters.mission === "aerobatic") {
      score = foil.symmetric === true ? 1 : foil.symmetric === false ? .42 : .60;
    }
  }
  const minT = parseOptionalNumber(state.filters.thicknessMin);
  const maxT = parseOptionalNumber(state.filters.thicknessMax);
  const maxC = parseOptionalNumber(state.filters.camberMax);
  if (minT !== null) score *= t === null ? .75 : t >= minT ? 1 : clamp(t/minT, .2, .95);
  if (maxT !== null) score *= t === null ? .75 : t <= maxT ? 1 : clamp(maxT/t, .2, .95);
  if (maxC !== null) score *= c === null ? .75 : Math.abs(c) <= maxC ? 1 : clamp(maxC/Math.abs(c), .15, .95);
  if (state.filters.symmetric) score *= foil.symmetric === true ? 1 : foil.symmetric === false ? .35 : .7;
  return clamp(score, 0, 1);
}

function missionScore(foil, mission) {
  if (mission === "general") return .68;
  const text = [...foil.useCases, ...foil.traits].join(" ").toLowerCase();
  const terms = {
    endurance: ["endurance","efficient","glider","laminar","low-re"],
    "high-lift": ["high lift","payload","stol","low-speed"],
    payload: ["payload","high lift","thick","wind turbine"],
    aerobatic: ["aerobatic","symmetric","bidirectional","predictable"],
    roughness: ["roughness","forgiving","predictable","turbulent"]
  }[mission] || [];
  const hits = terms.filter(term => text.includes(term)).length;
  return clamp(.35 + hits * .2, .25, 1);
}

function evidenceScore(foil) {
  const text = `${foil.evidence} ${foil.polarUrl || ""}`.toLowerCase();
  if (/wind-tunnel|experimental|measured/.test(text)) return 1;
  if (/published|extensive|historical data|naca geometry/.test(text)) return .78;
  if (foil.coordinateUrl) return .48;
  return .25;
}

function rangeScore(value, range) {
  if (!range || range.length !== 2 || !isFinite(value)) return .55;
  const [min,max] = range;
  if (value >= min && value <= max) {
    const center = Math.sqrt(Math.max(min,1)*Math.max(max,1));
    const width = Math.log(Math.max(max/min,1.01));
    return clamp(1 - Math.abs(Math.log(Math.max(value,1)/center))/(width*1.6), .75, 1);
  }
  const distance = value < min ? Math.log(Math.max(min/value,1)) : Math.log(Math.max(value/max,1));
  return clamp(Math.exp(-distance*1.35), .05, .72);
}

function handleCatalogClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const id = target.dataset.id;
  if (target.dataset.action === "details") openDetail(id);
  if (target.dataset.action === "status") toggleStatus(id, target.dataset.status);
}

function handleCatalogChange(event) {
  const target = event.target;
  if (target.dataset.action !== "compare") return;
  toggleCompare(target.dataset.id, target.checked);
}

function toggleStatus(id, status) {
  state.user.statuses[id] = state.user.statuses[id] === status ? "none" : status;
  if (state.user.statuses[id] === "none") delete state.user.statuses[id];
  saveUserData();
  renderAll();
  if (state.activeDetailId === id) openDetail(id, true);
}

function toggleCompare(id, checked) {
  const set = new Set(state.user.compare);
  if (checked) {
    if (set.size >= 6 && !set.has(id)) {
      alert("Comparison is limited to six airfoils so the plot remains readable.");
      renderAll();
      return;
    }
    set.add(id);
  } else set.delete(id);
  state.user.compare = [...set];
  saveUserData();
  updateCounts();
  if (state.view === "compare") renderCompare();
}

async function openDetail(id, rerender = false) {
  const foil = state.catalog.find(item => item.id === id);
  if (!foil) return;
  state.activeDetailId = id;
  const mode = state.view === "stabilizers" ? "stabilizer" : "wing";
  const score = scoreAirfoil(foil, mode);
  const status = state.user.statuses[id] || "none";
  const notes = state.user.notes[id] || "";
  const tests = state.user.tests[id] || [];
  const op = operatingPoint();
  const scoreColor = scoreColorFor(score.total);
  els.detailContent.innerHTML = `<div class="detail-shell">
    <div class="detail-hero">
      <div><p class="eyebrow">${escapeHtml(foil.family.toUpperCase())}</p><h2>${escapeHtml(foil.name)}</h2><p class="muted">${escapeHtml(foil.description || foil.useCases.join(" · "))}</p></div>
      <div class="detail-actions">
        <button class="button ${status === "want" ? "primary" : "secondary"}" data-detail-action="status" data-status="want">${status === "want" ? "✓ Want to try" : "Want to try"}</button>
        <button class="button ${status === "tried" ? "primary" : "secondary"}" data-detail-action="status" data-status="tried">${status === "tried" ? "✓ Tried" : "Mark tried"}</button>
        <button class="button secondary" data-detail-action="compare">${state.user.compare.includes(id) ? "Remove comparison" : "Add comparison"}</button>
      </div>
    </div>
    <div class="detail-grid">
      <section class="detail-card"><h3>Normalized section geometry</h3><canvas id="geometryCanvas" class="geometry-canvas" width="900" height="320"></canvas><div id="geometryMetrics" class="metrics-grid">${geometryMetricBoxes(foil)}</div><div id="geometryStatus" class="status-banner">Loading coordinate geometry…</div></section>
      <section class="detail-card"><h3>Project relevance</h3><div class="recommendation" style="--score-color:${scoreColor}"><strong>${Math.round(score.total)}/100 relevance.</strong> ${escapeHtml(recommendationText(foil, score, mode))}</div><div class="score-breakdown">${Object.entries(score.components).map(([key,value]) => scoreLine(key,value, componentMax(key))).join("")}</div><div class="metrics-grid"><div class="metric-box"><span>Project Re</span><strong>${formatNumber(op.re,3)}</strong></div><div class="metric-box"><span>Mach</span><strong>${op.mach.toFixed(3)}</strong></div><div class="metric-box"><span>Air density</span><strong>${op.rho.toFixed(3)} kg/m³</strong></div></div></section>
      <section class="detail-card"><h3>Specifications and provenance</h3><div class="provenance-list">
        <div class="provenance-item"><span>Recommended Re range</span><strong>${formatRange(foil.recommendedRe)}</strong></div>
        <div class="provenance-item"><span>Speed use</span><strong>${escapeHtml(foil.speedClass)}</strong></div>
        <div class="provenance-item"><span>Altitude use</span><strong>${escapeHtml(foil.altitudeClass)}</strong></div>
        <div class="provenance-item"><span>Evidence</span><strong>${escapeHtml(foil.evidence)}</strong></div>
        <div class="provenance-item"><span>Classification status</span><strong>${escapeHtml(foil.classificationConfidence)}; recommendations are algorithmic</strong></div>
      </div><div class="source-buttons" style="margin-top:14px"><a class="button secondary" href="${escapeAttr(foil.coordinateUrl)}" target="_blank" rel="noreferrer">Coordinate file</a><a class="button secondary" href="${escapeAttr(foil.officialSourceUrl)}" target="_blank" rel="noreferrer">UIUC source</a><a class="button secondary" href="${escapeAttr(foil.specificationUrl)}" target="_blank" rel="noreferrer">Search specifications/polars</a></div></section>
      <section class="detail-card"><h3>Project notes</h3><textarea class="notes-area" data-detail-input="notes" placeholder="Construction observations, expected strengths, reasons to test…">${escapeHtml(notes)}</textarea><div class="status-banner">Saved automatically in this browser and included in project exports.</div></section>
    </div>
    <section class="detail-card" style="margin-top:15px"><div class="panel-heading"><div><span class="eyebrow">REAL-WORLD DATA</span><h3>Test records</h3></div><button class="button secondary" data-detail-action="export-tests">Export CSV</button></div>
      <div class="table-wrap"><table class="tests-table"><thead><tr><th>Date</th><th>Speed</th><th>Altitude</th><th>Result</th><th>Notes</th><th></th></tr></thead><tbody id="testRows">${testRowsHtml(tests)}</tbody></table></div>
      <form id="testForm" style="margin-top:15px"><div class="test-form-grid">
        <label class="field"><span>Date</span><input name="date" type="date" required></label>
        <label class="field"><span>Speed (m/s)</span><input name="speed" type="number" min="0" step="0.1"></label>
        <label class="field"><span>Altitude (m)</span><input name="altitude" type="number" step="1"></label>
        <label class="field"><span>Chord (m)</span><input name="chord" type="number" min="0" step="0.001" value="${escapeAttr(state.user.project.chord)}"></label>
        <label class="field"><span>Angle of attack (°)</span><input name="aoa" type="number" step="0.1"></label>
        <label class="field"><span>Measured lift / Cl</span><input name="lift" type="text" placeholder="Value + unit or Cl"></label>
        <label class="field"><span>Measured drag / Cd</span><input name="drag" type="text" placeholder="Value + unit or Cd"></label>
        <label class="field"><span>Power (W)</span><input name="power" type="number" min="0" step="0.1"></label>
        <label class="field wide"><span>Result / outcome</span><input name="result" type="text" placeholder="e.g. stable cruise, tip stall, 18 m/s stall"></label>
        <label class="field wide"><span>Configuration</span><input name="configuration" type="text" placeholder="Wing span, mass, flap setting, surface finish…"></label>
        <label class="field full-span"><span>Notes</span><textarea name="notes" rows="3" placeholder="Conditions, handling, instrumentation, uncertainty…"></textarea></label>
      </div><div class="dialog-actions"><span></span><button type="submit" class="button primary">Add test record</button></div></form>
    </section>
  </div>`;
  if (!rerender || !els.detailDialog.open) els.detailDialog.showModal();
  requestAnimationFrame(() => drawPlaceholder(document.getElementById("geometryCanvas"), foil.name));
  await enrichGeometry(foil);
}

async function enrichGeometry(foil) {
  const canvas = document.getElementById("geometryCanvas");
  const status = document.getElementById("geometryStatus");
  const metrics = document.getElementById("geometryMetrics");
  if (!canvas || state.activeDetailId !== foil.id) return;
  try {
    const geometry = await getGeometry(foil);
    drawSingleGeometry(canvas, geometry.points, foil.name);
    Object.assign(foil, geometry.metrics);
    metrics.innerHTML = geometryMetricBoxes(foil);
    status.textContent = `${geometry.points.length} coordinate points loaded. Thickness and camber values shown here are derived from the coordinate file.`;
    renderCatalog();
  } catch (error) {
    console.warn(error);
    status.textContent = `Coordinate geometry unavailable: ${error.message}. Name-derived metadata remains visible.`;
    drawPlaceholder(canvas, foil.name);
  }
}

async function getGeometry(foil) {
  if (foil.coordinates?.length) return analyzeGeometry(foil.coordinates);
  const cached = loadGeometryCache(foil.id);
  if (cached) return cached;
  let points = null;
  if (/^naca\d{4}$/i.test(foil.id.replace(/[^a-z0-9]/gi,""))) points = generateNaca4(foil.id);
  if (!points && foil.coordinateUrl) {
    const response = await fetch(foil.coordinateUrl);
    if (!response.ok) throw new Error(`coordinate source returned ${response.status}`);
    points = parseDat(await response.text());
  }
  if (!points?.length) throw new Error("no parseable coordinates");
  const geometry = analyzeGeometry(points);
  saveGeometryCache(foil.id, geometry);
  return geometry;
}

function parseDat(text) {
  const points = [];
  for (const line of text.split(/\r?\n/)) {
    const clean = line.trim().replace(/,/g," ");
    if (!clean || clean.startsWith("#")) continue;
    const nums = clean.split(/\s+/).map(Number);
    if (nums.length >= 2 && Number.isFinite(nums[0]) && Number.isFinite(nums[1])) points.push([nums[0], nums[1]]);
  }
  if (points.length < 5) throw new Error("coordinate file format was not recognized");
  const xs = points.map(p=>p[0]);
  const min = Math.min(...xs), max = Math.max(...xs), chord = max-min || 1;
  return points.map(([x,y]) => [(x-min)/chord, y/chord]);
}

function generateNaca4(identifier, count = 121) {
  const digits = String(identifier).toLowerCase().replace(/[^0-9]/g, "").slice(-4);
  if (digits.length !== 4) return null;
  const m = Number(digits[0])/100;
  const p = Number(digits[1])/10;
  const t = Number(digits.slice(2))/100;
  const x = Array.from({length:count}, (_,i) => .5*(1-Math.cos(Math.PI*i/(count-1))));
  const upper = [], lower = [];
  for (const xi of x) {
    const yt = 5*t*(.2969*Math.sqrt(xi)-.1260*xi-.3516*xi**2+.2843*xi**3-.1015*xi**4);
    let yc=0, dy=0;
    if (m>0 && p>0) {
      if (xi<p) { yc=m/p**2*(2*p*xi-xi**2); dy=2*m/p**2*(p-xi); }
      else { yc=m/(1-p)**2*((1-2*p)+2*p*xi-xi**2); dy=2*m/(1-p)**2*(p-xi); }
    }
    const th=Math.atan(dy);
    upper.push([xi-yt*Math.sin(th), yc+yt*Math.cos(th)]);
    lower.push([xi+yt*Math.sin(th), yc-yt*Math.cos(th)]);
  }
  return [...upper.reverse(), ...lower.slice(1)];
}

function analyzeGeometry(points) {
  const clean = points.filter(p => p.length>=2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const leIndex = clean.reduce((best,p,i)=>p[0]<clean[best][0]?i:best,0);
  let upper = clean.slice(0, leIndex+1).reverse();
  let lower = clean.slice(leIndex);
  if (upper.length<2 || lower.length<2) {
    const sorted = [...clean].sort((a,b)=>a[0]-b[0]);
    upper=sorted.filter(p=>p[1]>=0); lower=sorted.filter(p=>p[1]<=0);
  }
  upper=dedupeByX(upper); lower=dedupeByX(lower);
  const samples = Array.from({length:401},(_,i)=>i/400);
  let maxT=-Infinity, maxTx=0, maxC=0, maxCx=0;
  for (const x of samples) {
    const yu=interpolate(upper,x), yl=interpolate(lower,x);
    if (yu===null || yl===null) continue;
    const th=yu-yl, ca=(yu+yl)/2;
    if (th>maxT) { maxT=th; maxTx=x; }
    if (Math.abs(ca)>Math.abs(maxC)) { maxC=ca; maxCx=x; }
  }
  const teU=interpolate(upper,1), teL=interpolate(lower,1);
  return { points: clean, metrics: {
    thickness: Number.isFinite(maxT) ? maxT*100 : null,
    thicknessPosition: maxTx*100,
    camber: Number.isFinite(maxC) ? maxC*100 : null,
    camberPosition: maxCx*100,
    trailingEdgeThickness: teU!==null&&teL!==null ? (teU-teL)*100 : null,
    symmetric: Number.isFinite(maxC) ? Math.abs(maxC)<0.0025 : null
  }};
}

function dedupeByX(points) {
  const map=new Map();
  points.forEach(([x,y])=>{ const k=x.toFixed(7); if(!map.has(k)||Math.abs(y)>Math.abs(map.get(k)[1])) map.set(k,[x,y]); });
  return [...map.values()].sort((a,b)=>a[0]-b[0]);
}

function interpolate(points,x) {
  if (!points.length || x<points[0][0]-1e-6 || x>points.at(-1)[0]+1e-6) return null;
  for (let i=1;i<points.length;i++) {
    const a=points[i-1], b=points[i];
    if (x<=b[0]+1e-9) {
      const dx=b[0]-a[0]; if(Math.abs(dx)<1e-12) return (a[1]+b[1])/2;
      const q=(x-a[0])/dx; return a[1]+q*(b[1]-a[1]);
    }
  }
  return points.at(-1)[1];
}

function drawSingleGeometry(canvas, points, label) {
  setupCanvas(canvas);
  const ctx=canvas.getContext("2d");
  const w=canvas.clientWidth, h=canvas.clientHeight;
  ctx.clearRect(0,0,w,h);
  drawGrid(ctx,w,h);
  const ys=points.map(p=>p[1]); const ymin=Math.min(...ys,-.12), ymax=Math.max(...ys,.12);
  const pad=32, sx=(w-2*pad), sy=(h-2*pad)/(ymax-ymin);
  ctx.beginPath();
  points.forEach(([x,y],i)=>{ const px=pad+x*sx, py=h-pad-(y-ymin)*sy; i?ctx.lineTo(px,py):ctx.moveTo(px,py); });
  ctx.strokeStyle="#61d4b3"; ctx.lineWidth=2.2; ctx.stroke();
  ctx.fillStyle="#9fb0c2"; ctx.font="12px system-ui"; ctx.fillText(label, pad, 21);
  ctx.fillText("Normalized chord", Math.max(pad,w-136), h-10);
}

function drawPlaceholder(canvas,label) {
  setupCanvas(canvas); const ctx=canvas.getContext("2d"), w=canvas.clientWidth,h=canvas.clientHeight;
  ctx.clearRect(0,0,w,h); drawGrid(ctx,w,h); ctx.strokeStyle="#708196"; ctx.setLineDash([7,6]); ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(30,h*.55); ctx.bezierCurveTo(w*.24,h*.29,w*.69,h*.33,w-30,h*.51); ctx.bezierCurveTo(w*.62,h*.57,w*.25,h*.64,30,h*.55); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle="#9fb0c2"; ctx.font="12px system-ui"; ctx.fillText(`${label} — loading geometry`,30,22);
}

function drawGrid(ctx,w,h) {
  ctx.strokeStyle="#172a3d"; ctx.lineWidth=1;
  for(let i=1;i<10;i++){ctx.beginPath();ctx.moveTo(i*w/10,0);ctx.lineTo(i*w/10,h);ctx.stroke();}
  for(let i=1;i<6;i++){ctx.beginPath();ctx.moveTo(0,i*h/6);ctx.lineTo(w,i*h/6);ctx.stroke();}
}

function setupCanvas(canvas) {
  const dpr=Math.min(devicePixelRatio||1,2); const rect=canvas.getBoundingClientRect();
  const width=Math.max(320,Math.round(rect.width)), height=Math.max(220,Math.round(rect.height));
  if(canvas.width!==width*dpr||canvas.height!==height*dpr){canvas.width=width*dpr;canvas.height=height*dpr;}
  const ctx=canvas.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0);
}

function geometryMetricBoxes(foil) {
  return `<div class="metric-box"><span>Max thickness</span><strong>${formatPercent(foil.thickness)}</strong></div><div class="metric-box"><span>Thickness at</span><strong>${formatPercent(foil.thicknessPosition)}</strong></div><div class="metric-box"><span>Max camber</span><strong>${formatSignedPercent(foil.camber)}</strong></div><div class="metric-box"><span>Camber at</span><strong>${formatPercent(foil.camberPosition)}</strong></div><div class="metric-box"><span>Trailing edge</span><strong>${formatPercent(foil.trailingEdgeThickness)}</strong></div><div class="metric-box"><span>Symmetry</span><strong>${foil.symmetric===true?"Symmetric":foil.symmetric===false?"Cambered":"Unknown"}</strong></div>`;
}

function recommendationText(foil, score, mode) {
  const op=operatingPoint(); const reFit=rangeScore(op.re,foil.recommendedRe);
  if(mode==="stabilizer") {
    if(foil.symmetric===true && reFit>.65) return "A plausible tail-section candidate at the current Reynolds number. Verify pitching moment, hinge/control-surface behavior, and stall progression with matched polars or tests.";
    if(foil.symmetric===false) return "Camber reduces its default tail score. It can still be valid for a lifting tail or trim-specific design, but the required tail load and pitching moment must be modeled explicitly.";
    return "Geometry or moment information is incomplete. Treat this as a comparison candidate until the section is enriched and analyzed.";
  }
  if(score.total>=80) return "Strong catalog match for the current ranking assumptions. Compare matched-Re polars, roughness sensitivity, structural thickness, and three-dimensional wing behavior before selection.";
  if(score.total>=60) return "Reasonable candidate with one or more compromises. Read the score breakdown and test at the same Reynolds number and surface condition as the aircraft.";
  return "Weak or uncertain match for the current operating point. It remains visible because unusual constraints may justify it, but it should not be shortlisted from this score alone.";
}

function scoreLine(label,value,max) {
  const percent=clamp(value/max*100,0,100);
  return `<div class="score-line"><span>${escapeHtml(titleCase(label))}</span><div class="score-track"><i style="width:${percent}%"></i></div><strong>${Math.round(value)}</strong></div>`;
}
function componentMax(key){return {reynolds:35,mach:10,mission:20,geometry:25,evidence:10}[key]||10;}

function handleDetailClick(event) {
  const target=event.target.closest("[data-detail-action], [data-test-index]"); if(!target||!state.activeDetailId)return;
  const id=state.activeDetailId;
  const action=target.dataset.detailAction;
  if(action==="status") toggleStatus(id,target.dataset.status);
  if(action==="compare") { toggleCompare(id,!state.user.compare.includes(id)); openDetail(id,true); }
  if(action==="export-tests") exportTestsCsv(id);
  if(target.dataset.testIndex!==undefined){ const tests=state.user.tests[id]||[]; tests.splice(Number(target.dataset.testIndex),1); state.user.tests[id]=tests; saveUserData(); openDetail(id,true); }
}

function handleDetailInput(event) {
  if(!state.activeDetailId)return;
  if(event.target.dataset.detailInput==="notes") { state.user.notes[state.activeDetailId]=event.target.value; saveUserData(); }
}

function handleDetailSubmit(event) {
  if(event.target.id!=="testForm"||!state.activeDetailId)return;
  event.preventDefault(); const fd=new FormData(event.target); const record=Object.fromEntries(fd.entries()); record.createdAt=new Date().toISOString();
  state.user.tests[state.activeDetailId] ||= []; state.user.tests[state.activeDetailId].push(record); saveUserData(); openDetail(state.activeDetailId,true);
}

function testRowsHtml(tests) {
  if(!tests.length)return `<tr><td colspan="6" class="muted">No test records yet.</td></tr>`;
  return tests.map((t,i)=>`<tr><td>${escapeHtml(t.date||"—")}</td><td>${t.speed?`${escapeHtml(t.speed)} m/s`:"—"}</td><td>${t.altitude?`${escapeHtml(t.altitude)} m`:"—"}</td><td>${escapeHtml(t.result||"—")}</td><td>${escapeHtml(t.notes||t.configuration||"—")}</td><td><button class="text-button danger-text" type="button" data-test-index="${i}">Delete</button></td></tr>`).join("");
}

async function renderCompare() {
  const foils=state.user.compare.map(id=>state.catalog.find(f=>f.id===id)).filter(Boolean);
  els.compareEmpty.hidden=foils.length>0; els.compareContent.hidden=foils.length===0; if(!foils.length)return;
  const results=await Promise.all(foils.map(async foil=>{try{return {foil,geometry:await getGeometry(foil),score:scoreAirfoil(foil,"wing")};}catch{return {foil,geometry:null,score:scoreAirfoil(foil,"wing")};}}));
  drawComparison(els.compareCanvas,results.filter(r=>r.geometry));
  els.compareTableWrap.innerHTML=`<table class="airfoil-table"><thead><tr><th>Airfoil</th><th>Match</th><th>Thickness</th><th>Camber</th><th>Recommended Re</th><th>Primary use</th><th></th></tr></thead><tbody>${results.map(({foil,geometry,score})=>`<tr style="--row-score:${scoreColorFor(score.total)}"><td><button class="airfoil-name-button" data-action="details" data-id="${escapeAttr(foil.id)}">${escapeHtml(foil.name)}</button></td><td>${Math.round(score.total)}</td><td>${formatPercent(geometry?.metrics.thickness??foil.thickness)}</td><td>${formatSignedPercent(geometry?.metrics.camber??foil.camber)}</td><td>${formatRange(foil.recommendedRe)}</td><td>${escapeHtml(foil.useCases[0]||"—")}</td><td><button class="text-button" data-compare-remove="${escapeAttr(foil.id)}">Remove</button></td></tr>`).join("")}</tbody></table>`;
  els.compareTableWrap.querySelectorAll("[data-action='details']").forEach(btn=>btn.addEventListener("click",()=>openDetail(btn.dataset.id)));
  els.compareTableWrap.querySelectorAll("[data-compare-remove]").forEach(btn=>btn.addEventListener("click",()=>toggleCompare(btn.dataset.compareRemove,false)));
}

function drawComparison(canvas,results) {
  setupCanvas(canvas); const ctx=canvas.getContext("2d"),w=canvas.clientWidth,h=canvas.clientHeight; ctx.clearRect(0,0,w,h); drawGrid(ctx,w,h);
  const colors=["#61d4b3","#82aaff","#f3b95f","#da83f2","#ff7b7b","#b8cf5d"];
  const all=results.flatMap(r=>r.geometry.points.map(p=>p[1])); const ymin=Math.min(...all,-.12),ymax=Math.max(...all,.12); const pad=38,sx=w-2*pad,sy=(h-2*pad)/(ymax-ymin);
  results.forEach((r,index)=>{ctx.beginPath();r.geometry.points.forEach(([x,y],i)=>{const px=pad+x*sx,py=h-pad-(y-ymin)*sy;i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.strokeStyle=colors[index%colors.length];ctx.lineWidth=2;ctx.stroke();ctx.fillStyle=colors[index%colors.length];ctx.fillRect(pad+index*145,12,12,3);ctx.fillStyle="#d9e5f0";ctx.font="11px system-ui";ctx.fillText(r.foil.name,pad+17+index*145,17);});
}

function redrawActiveGeometry() { const foil=state.catalog.find(f=>f.id===state.activeDetailId); if(foil) enrichGeometry(foil); }

function operatingPoint(project=state.user.project) {
  const h=Number(project.altitude)||0; const tempC=Number(project.temperature); const tempK=(Number.isFinite(tempC)?tempC:15)+273.15;
  const p=h<=11000?101325*Math.pow(Math.max(0.05,1-2.25577e-5*h),5.25588):22632*Math.exp(-(h-11000)/6341.62);
  const rho=p/(287.05*tempK); const mu=1.716e-5*Math.pow(tempK/273.15,1.5)*(273.15+111)/(tempK+111); const a=Math.sqrt(1.4*287.05*tempK);
  const speed=Number(project.speed)||0, chord=Number(project.chord)||0;
  return {rho,mu,a,re:rho*speed*chord/mu,mach:speed/a,pressure:p};
}

function updateOperatingSummary() {
  const op=operatingPoint(), p=state.user.project;
  els.operatingSummary.innerHTML=`<div class="summary-chip"><span>Speed</span><strong>${formatNumber(p.speed)} m/s</strong></div><div class="summary-chip"><span>Chord</span><strong>${formatNumber(p.chord)} m</strong></div><div class="summary-chip"><span>Altitude</span><strong>${formatNumber(p.altitude)} m</strong></div><div class="summary-chip"><span>Reynolds</span><strong>${formatNumber(op.re,3)}</strong></div><div class="summary-chip"><span>Mach</span><strong>${op.mach.toFixed(3)}</strong></div>`;
}

function populateProjectForm(){setProjectForm(state.user.project);}
function setProjectForm(p){els.projectName.value=p.name??"";els.projectSpeed.value=p.speed;els.projectChord.value=p.chord;els.projectAltitude.value=p.altitude;els.projectTemperature.value=p.temperature;els.projectCl.value=p.targetCl??"";}
function readProjectForm(){return{name:els.projectName.value.trim()||"Airfoil project",speed:Number(els.projectSpeed.value),chord:Number(els.projectChord.value),altitude:Number(els.projectAltitude.value),temperature:Number(els.projectTemperature.value),targetCl:els.projectCl.value};}
function updateCalculatedProject(){const p={speed:Number(els.projectSpeed.value),chord:Number(els.projectChord.value),altitude:Number(els.projectAltitude.value),temperature:Number(els.projectTemperature.value)};const op=operatingPoint(p);els.projectCalculated.innerHTML=`<div><span>Chord Reynolds number</span><strong>${formatNumber(op.re,4)}</strong></div><div><span>Mach number</span><strong>${op.mach.toFixed(4)}</strong></div><div><span>Air density</span><strong>${op.rho.toFixed(4)} kg/m³</strong></div>`;}

function exportProjectData(){downloadJson(`${slugify(state.user.project.name)}-airfoil-project.json`,{schema:"airfoil-atlas-project-v1",exportedAt:new Date().toISOString(),projectData:state.user});}
async function importProjectData(event){const file=event.target.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text());state.user=normalizeUserData(data.projectData||data);saveUserData();populateProjectForm();updateOperatingSummary();renderAll();els.dataDialog.close();}catch(error){alert(`Could not import project: ${error.message}`);}finally{event.target.value="";}}
function exportCatalogCsv(){const rows=[["Rank","Score","Name","ID","Family","Thickness %","Camber %","Symmetric","Recommended Re min","Recommended Re max","Status","Use cases"]];state.filtered.forEach((item,i)=>rows.push([i+1,Math.round(item.score.total),item.foil.name,item.foil.id,item.foil.family,item.foil.thickness??"",item.foil.camber??"",item.foil.symmetric??"",item.foil.recommendedRe?.[0]??"",item.foil.recommendedRe?.[1]??"",state.user.statuses[item.foil.id]||"",item.foil.useCases.join("; ")]));downloadText(`${slugify(state.user.project.name)}-ranked-airfoils.csv`,rows.map(r=>r.map(csvCell).join(",")).join("\n"),"text/csv");}
function exportTestsCsv(id){const foil=state.catalog.find(f=>f.id===id),tests=state.user.tests[id]||[];const fields=["date","speed","altitude","chord","aoa","lift","drag","power","result","configuration","notes","createdAt"];const rows=[fields,...tests.map(t=>fields.map(f=>t[f]??""))];downloadText(`${slugify(foil?.name||id)}-tests.csv`,rows.map(r=>r.map(csvCell).join(",")).join("\n"),"text/csv");}
function clearProjectData(){if(!confirm("Clear all statuses, notes, tests, comparison selections, and project settings stored in this browser?"))return;localStorage.removeItem(STORAGE_KEY);state.user=normalizeUserData({});saveUserData();populateProjectForm();renderAll();els.dataDialog.close();}

function loadUserData(){try{return normalizeUserData(JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}"));}catch{return normalizeUserData({});}}
function normalizeUserData(raw){return{project:{...DEFAULT_PROJECT,...(raw.project||{})},statuses:raw.statuses||{},notes:raw.notes||{},tests:raw.tests||{},compare:Array.isArray(raw.compare)?raw.compare.slice(0,6):[]};}
function saveUserData(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state.user));}
function saveCatalogCache(entries){try{localStorage.setItem(CATALOG_CACHE_KEY,JSON.stringify({savedAt:Date.now(),entries}));}catch(error){console.warn("Catalog cache unavailable",error);}}
function loadCatalogCache(){try{const parsed=JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY)||"{}");return Array.isArray(parsed.entries)?parsed.entries:[];}catch{return[];}}
function saveGeometryCache(id,geometry){try{localStorage.setItem(GEOMETRY_PREFIX+id,JSON.stringify(geometry));}catch{}}
function loadGeometryCache(id){try{return JSON.parse(localStorage.getItem(GEOMETRY_PREFIX+id)||"null");}catch{return null;}}

function setCatalogStatus(text){els.catalogStatus.textContent=text;}
function evidenceLabel(foil){const score=evidenceScore(foil);return score>.9?"Measured/published":score>.7?"Published/known":score>.4?"Geometry only":"Limited";}
function geometrySummary(foil){if(foil.thickness!==null&&foil.camber!==null)return `${formatPercent(foil.thickness)} t · ${formatSignedPercent(foil.camber)} c`;if(foil.thickness!==null)return `${formatPercent(foil.thickness)} thickness`;return "Open to measure";}
function formatPercent(v){return v===null||v===undefined||!Number.isFinite(Number(v))?"—":`${Number(v).toFixed(Number(v)<1?2:1)}%`;}
function formatSignedPercent(v){return v===null||v===undefined||!Number.isFinite(Number(v))?"—":`${Number(v)>=0?"":"−"}${Math.abs(Number(v)).toFixed(Math.abs(Number(v))<1?2:1)}%`;}
function formatRange(r){if(!r||r.length!==2)return"Unknown";return`${formatNumber(r[0],2)}–${formatNumber(r[1],2)}`;}
function formatNumber(value,sig=3){const n=Number(value);if(!Number.isFinite(n))return"—";if(Math.abs(n)>=1e6)return`${(n/1e6).toPrecision(sig).replace(/\.0+$/,'')}M`;if(Math.abs(n)>=1e3)return`${(n/1e3).toPrecision(sig).replace(/\.0+$/,'')}k`;return Number.isInteger(n)?n.toLocaleString():n.toFixed(Math.max(0,sig-1));}
function scoreColorFor(score){return score>=80?"var(--excellent)":score>=62?"var(--good)":score>=42?"var(--fair)":"var(--poor)";}
function statusRank(s){return s==="tried"?2:s==="want"?1:0;}
function validRange(v){return Array.isArray(v)&&v.length===2&&v.every(Number.isFinite)?v:null;}
function finiteOrNull(v){const n=Number(v);return v===null||v===""||!Number.isFinite(n)?null:n;}
function nullableNumber(v,fallback){return v===null||v===undefined||!Number.isFinite(Number(v))?fallback:Number(v);}
function parseOptionalNumber(v){return v===""||v===null?null:Number(v);}
function clamp(v,min,max){return Math.min(max,Math.max(min,v));}
function bellScore(v,center,width){return Math.exp(-0.5*((v-center)/width)**2);}
function unique(a){return [...new Set(a.filter(Boolean))];}
function titleCase(s){return s.replace(/(^|\s)\S/g,m=>m.toUpperCase());}
function slugify(s){return String(s||"airfoil").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");}
function escapeHtml(s){return String(s??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
function escapeAttr(s){return escapeHtml(s);}
function csvCell(value){const s=String(value??"");return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function debounce(fn,ms){let timer;return(...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),ms);};}
function scrollCatalogTop(){document.querySelector(".catalog-panel")?.scrollIntoView({behavior:"smooth",block:"start"});}
function downloadJson(name,obj){downloadText(name,JSON.stringify(obj,null,2),"application/json");}
function downloadText(name,text,type){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
