// Entradas de Almacén — FO-MBT-ALM-02
// Dos vistas: "Registrar" (formulario → POST al endpoint) y "Entradas"
// (consulta vía GET al mismo endpoint, con filtros/orden). Historial local
// en localStorage sirve de respaldo mientras no hay endpoint configurado
// o si una petición falla.

const STORAGE_HISTORY = 'almacen.entradas.historial';
const STORAGE_THEME = 'almacen.entradas.theme';
const STORAGE_THEME_HINT = 'almacen.entradas.temaHintVisto';

let historial = [];          // caché local persistida (localStorage)
let entradas = [];           // dataset actualmente mostrado en la vista "Entradas"
let entradasLoaded = false;  // ya se intentó cargar al menos una vez
// Por default se ordena por orden de captura (más nuevo primero), no por
// Fecha — así una entrada recién registrada siempre cae en la primera fila,
// aunque su Fecha sea retroactiva. El usuario puede cambiarlo con un clic
// en cualquier encabezado de columna.
let sortState = { col: '_sortKey', dir: 'desc' };

const REGISTROS_POR_PAGINA = 70;
let paginaActual = 1;

// Columnas con texto libre largo (pedidos con notas de compra completas, un
// "Correo electrónico" que a veces trae texto en vez de un email, etc.) que
// se recortan a 2 líneas en la tabla — cada una con su propio ancho máximo,
// según cuánto contenido normal se espera. El texto completo queda en el title.
const LONG_TEXT_COLS = {
  'Correo electrónico': 220,
  'Pedido / Reporte': 260,
};

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  renderFields();
  setDefaultDate();
  showTodayDate();
  loadHistorial();
  populateFilterOptions();
  document.getElementById('entryForm').addEventListener('submit', onSubmit);
  document.getElementById('resetBtn').addEventListener('click', () => {
    document.getElementById('entryForm').reset();
    setDefaultDate();
  });
  document.getElementById('exportBtn').addEventListener('click', exportCsv);
  document.getElementById('exportExcelBtn').addEventListener('click', exportExcel);
  document.getElementById('refreshBtn').addEventListener('click', () => loadEntradas());

  document.getElementById('successModalClose').addEventListener('click', hideModal);
  document.getElementById('successModal').addEventListener('click', e => {
    if (e.target.id === 'successModal') hideModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideModal();
  });

  document.querySelectorAll('.nav-item, .portal-circle').forEach(btn => {
    if (!btn.dataset.view) return; // p. ej. el enlace externo "Dashboard"
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  document.getElementById('themeDotsBtn').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('themePanel').classList.toggle('hidden');
    document.getElementById('themeHint').classList.add('hidden');
  });
  document.querySelectorAll('.theme-opt').forEach(opt => {
    opt.addEventListener('click', () => setTheme(opt.dataset.themeId));
  });
  document.addEventListener('click', e => {
    const panel = document.getElementById('themePanel');
    const btn = document.getElementById('themeDotsBtn');
    if (!panel.classList.contains('hidden') && !panel.contains(e.target) && e.target !== btn) {
      panel.classList.add('hidden');
    }
  });

  // Empresa/Proyecto/Proveedor son un cascadeo: cambiar uno recalcula las
  // opciones de los otros dos según lo que realmente coexiste en los datos.
  ['fEmpresa', 'fProyecto', 'fProveedor'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      actualizarOpcionesCascada();
      paginaActual = 1;
      renderEntradas();
    });
  });
  ['fBuscar', 'fDesde', 'fHasta'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      paginaActual = 1;
      renderEntradas();
    });
  });
  document.getElementById('fClear').addEventListener('click', () => {
    ['fBuscar', 'fEmpresa', 'fProyecto', 'fProveedor', 'fDesde', 'fHasta'].forEach(id => {
      document.getElementById(id).value = '';
    });
    actualizarOpcionesCascada();
    paginaActual = 1;
    renderEntradas();
  });

  // Las celdas de texto largo (Pedido / Reporte) se expanden con un clic
  // para ver el contenido completo, y se vuelven a recortar con otro clic.
  document.getElementById('entradasWrap').addEventListener('click', e => {
    const td = e.target.closest('.td-clamp');
    if (td) td.classList.toggle('expanded');
  });

  // La vista inicial ya es "Inicio" por el HTML — pasa por switchView() para
  // que dispare el mismo aviso de tema que al navegar de vuelta al home.
  // Se reemplaza (no se apila) la entrada del historial para que sea el
  // punto de partida, no un salto extra antes de la app.
  const VISTAS_VALIDAS = ['inicio', 'registrar', 'entradas'];
  let vistaInicial = (location.hash || '#inicio').slice(1);
  if (!VISTAS_VALIDAS.includes(vistaInicial)) vistaInicial = 'inicio';
  history.replaceState({ view: vistaInicial }, '', '#' + vistaInicial);
  switchView(vistaInicial, false);
});

// ---------- Navegación entre vistas ----------

// pushHistory=false se usa cuando la navegación ya viene del historial
// (botón "Atrás"/"Adelante"), para no volver a apilar la misma entrada.
function switchView(view, pushHistory = true) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-' + view).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  // El sidebar y el título del topbar se ocultan en "Inicio" para que el
  // portal se vea a pantalla completa (su propio título ya lo muestra) y sin
  // duplicar navegación; en el resto de vistas vuelven a mostrarse.
  document.getElementById('sidebar').classList.toggle('hidden', view === 'inicio');
  document.getElementById('topTitleGroup').classList.toggle('hidden', view === 'inicio');
  if (view === 'entradas' && !entradasLoaded) loadEntradas();
  if (view === 'inicio') mostrarAvisoTema();

  // Cada cambio de vista queda como su propia entrada en el historial del
  // navegador — si no, "Atrás" se salta la app entera y cae directo en el
  // redireccionamiento de autenticación de Microsoft que abrió la página.
  if (pushHistory) history.pushState({ view }, '', '#' + view);
}

window.addEventListener('popstate', e => {
  switchView(e.state?.view || 'inicio', false);
});

// ---------- Formulario ----------

function renderFields() {
  const wrap = document.getElementById('formFields');
  wrap.innerHTML = FIELDS.map(f => {
    const reqAttr = f.required ? 'required' : '';
    const reqMark = f.required ? '<span class="req">*</span>' : '';
    let control;

    if (f.type === 'select') {
      const opts = f.options.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
      control = `<select id="${f.id}" name="${f.id}" ${reqAttr}><option value="" disabled selected>Selecciona…</option>${opts}</select>`;
    } else if (f.type === 'combo') {
      const listId = `${f.id}List`;
      const opts = f.options.map(o => `<option value="${escapeHtml(o)}">`).join('');
      control = `<input id="${f.id}" name="${f.id}" list="${listId}" ${reqAttr} autocomplete="off" placeholder="${escapeHtml(f.placeholder || '')}"/><datalist id="${listId}">${opts}</datalist>`;
    } else if (f.type === 'textarea') {
      control = `<textarea id="${f.id}" name="${f.id}" ${reqAttr} placeholder="${escapeHtml(f.placeholder || '')}"></textarea>`;
    } else if (f.type === 'number') {
      control = `<input type="number" id="${f.id}" name="${f.id}" ${reqAttr} min="0" step="1" placeholder="${escapeHtml(f.placeholder || '')}"/>`;
    } else if (f.type === 'date') {
      control = `<input type="date" id="${f.id}" name="${f.id}" ${reqAttr}/>`;
    } else {
      control = `<input type="text" id="${f.id}" name="${f.id}" ${reqAttr} placeholder="${escapeHtml(f.placeholder || '')}"/>`;
    }

    return `<div class="field${f.full ? ' full' : ''}"><label for="${f.id}">${escapeHtml(f.label)}${reqMark}</label>${control}</div>`;
  }).join('');
}

function setDefaultDate() {
  const fecha = document.getElementById('fecha');
  if (fecha && !fecha.value) {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    fecha.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const estatus = document.getElementById('estatus');
  if (estatus && !estatus.value) estatus.value = 'COMPLETA';
}

function readFormValues() {
  const values = {};
  FIELDS.forEach(f => {
    const el = document.getElementById(f.id);
    let val = el.value.trim();
    if (!val && f.emptyValue) val = f.emptyValue;
    values[f.label] = val;
  });
  return values;
}

// La columna "Fecha" de la lista es texto libre en formato DD/MM/AAAA (no una
// columna de fecha real), mientras que <input type="date"> trabaja en ISO
// (AAAA-MM-DD) — estas dos funciones convierten entre ambos formatos.
function isoToDDMMYYYY(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

function ddmmyyyyToIso(str) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(str || '').trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// Arma el body en el formato real de la lista de SharePoint: nombres de columna
// internos (f.key) y, para columnas Choice, el objeto que espera el conector.
function buildSharePointPayload(values) {
  const payload = {};
  FIELDS.forEach(f => {
    let val = values[f.label];
    if (f.type === 'number') val = val === '' ? null : Number(val);
    if (f.type === 'date') val = isoToDDMMYYYY(val);
    if (f.choice && CONFIG.SEND_CHOICE_AS_OBJECT) {
      payload[f.key] = { '@odata.type': CHOICE_ODATA_TYPE, Id: 0, Value: val };
    } else {
      payload[f.key] = val;
    }
  });
  return payload;
}

async function onSubmit(e) {
  e.preventDefault();
  const values = readFormValues();
  values['Fecha'] = isoToDDMMYYYY(values['Fecha']);

  const record = {
    ...values,
    _timestamp: new Date().toISOString(),
    _estado: isCreateConfigured() ? 'enviando' : 'local',
    // Más grande que cualquier ID real de SharePoint, para que quede primero
    // de inmediato sin esperar al siguiente refresh (que le pondrá su _sortKey
    // real basado en el ID que le asigne la lista).
    _sortKey: Date.now(),
  };

  if (!isCreateConfigured()) {
    saveHistorial(record);
    pushEntradaLocal(record);
    showModal('Se guardó localmente (sin endpoint de creación configurado todavía).');
    document.getElementById('entryForm').reset();
    setDefaultDate();
    return;
  }

  try {
    const res = await fetch(CONFIG.CREATE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSharePointPayload(values)),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    record._estado = 'enviado';
    saveHistorial(record);
    pushEntradaLocal(record);
    showModal('Tu entrada quedó registrada en SharePoint.');
    document.getElementById('entryForm').reset();
    setDefaultDate();
  } catch (err) {
    record._estado = 'error';
    record._error = String(err.message || err);
    saveHistorial(record);
    pushEntradaLocal(record);
    toast('No se pudo enviar al endpoint de creación — se guardó localmente. ' + record._error, 'err');
  }
}

// Refleja de inmediato un registro recién capturado en la vista "Entradas",
// sin esperar a un refetch — solo si esa vista ya se cargó alguna vez.
function pushEntradaLocal(record) {
  entradas.unshift(record);
  if (entradasLoaded) renderEntradas();
}

// ---------- Historial local (respaldo / caché offline) ----------

function loadHistorial() {
  try {
    historial = JSON.parse(localStorage.getItem(STORAGE_HISTORY) || '[]');
  } catch {
    historial = [];
  }
}

function saveHistorial(record) {
  historial.unshift(record);
  localStorage.setItem(STORAGE_HISTORY, JSON.stringify(historial));
}

// ---------- Vista "Entradas": carga, parseo, filtros y orden ----------

// Convierte un item crudo de SharePoint (formato del "Get items") a un
// registro plano con las mismas llaves (f.label) que usa el formulario.
function parseListItem(raw) {
  const rec = {};
  FIELDS.forEach(f => {
    let val = raw[f.key];
    if (f.choice && val && typeof val === 'object') val = val.Value ?? '';
    if (typeof val === 'string') val = val.trim();
    rec[f.label] = (val === undefined || val === null) ? '' : val;
  });
  rec._estado = 'enviado';
  rec._id = raw.ID ?? raw.Id ?? null;
  rec._sortKey = Number(rec._id) || 0;
  return rec;
}

async function fetchEntradasRemotas() {
  const res = await fetch(CONFIG.READ_ENDPOINT);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data) ? data
    : Array.isArray(data.value) ? data.value
    : Array.isArray(data.items) ? data.items
    : [];
  return items.map(parseListItem);
}

async function loadEntradas() {
  const note = document.getElementById('entradasSourceNote');
  const refreshBtn = document.getElementById('refreshBtn');
  const esPrimeraCarga = !entradasLoaded;
  paginaActual = 1;
  refreshBtn.disabled = true;
  const prevLabel = refreshBtn.textContent;
  refreshBtn.textContent = '↻ Cargando…';

  if (isReadConfigured()) {
    try {
      entradas = await fetchEntradasRemotas();
      note.textContent = `Datos en vivo desde SharePoint · ${entradas.length} registro(s).`;
    } catch (err) {
      entradas = historial.slice();
      note.textContent = `No se pudo leer el endpoint de lectura (${err.message}) — mostrando historial local.`;
    }
  } else {
    entradas = historial.slice();
    note.textContent = 'Endpoint de lectura no configurado — mostrando historial local de este navegador.';
  }

  actualizarOpcionesCascada();
  if (esPrimeraCarga) aplicarFiltroFechaMasReciente();

  refreshBtn.disabled = false;
  refreshBtn.textContent = prevLabel;
  entradasLoaded = true;
  renderEntradas();
}

// Al primer cargue, deja la vista ya filtrada al día más reciente que exista
// en los datos (no un valor fijo) — así "Entradas" abre mostrando lo último
// en vez de las miles de filas históricas. Si el usuario ya tocó los filtros
// de fecha (p. ej. desde la URL o una recarga posterior), no los pisa.
function aplicarFiltroFechaMasReciente() {
  const fDesde = document.getElementById('fDesde');
  const fHasta = document.getElementById('fHasta');
  if (fDesde.value || fHasta.value) return;

  let maxIso = null;
  entradas.forEach(r => {
    const iso = ddmmyyyyToIso(r['Fecha']);
    if (iso && (!maxIso || iso > maxIso)) maxIso = iso;
  });
  if (maxIso) {
    fDesde.value = maxIso;
    fHasta.value = maxIso;
  }
}

function populateFilterOptions() {
  fillSelect('fEmpresa', CONFIG.EMPRESA); // placeholder mientras carga la lista real
}

// Cascadeo Empresa / Proyecto / Proveedor (como en Power Apps): las opciones
// de cada uno se recalculan con lo que realmente coexiste en los datos dado
// lo que ya está elegido en los OTROS dos — así seleccionar un Proyecto deja
// en "Proveedor" solo a los proveedores que de verdad aparecen en ese proyecto.
function actualizarOpcionesCascada() {
  const empresa = document.getElementById('fEmpresa').value;
  const proyecto = document.getElementById('fProyecto').value;
  const proveedor = document.getElementById('fProveedor').value;
  const uniq = rows => [...new Set(rows)].filter(Boolean).sort((a, b) => a.localeCompare(b));

  fillSelect('fEmpresa', uniq(entradas
    .filter(r => (!proyecto || r['Proyecto'] === proyecto) && (!proveedor || r['Proveedor'] === proveedor))
    .map(r => r['Empresa'])));

  fillSelect('fProyecto', uniq(entradas
    .filter(r => (!empresa || r['Empresa'] === empresa) && (!proveedor || r['Proveedor'] === proveedor))
    .map(r => r['Proyecto'])));

  fillSelect('fProveedor', uniq(entradas
    .filter(r => (!empresa || r['Empresa'] === empresa) && (!proyecto || r['Proyecto'] === proyecto))
    .map(r => r['Proveedor'])));
}

function fillSelect(id, options) {
  const sel = document.getElementById(id);
  const prevValue = sel.value;
  const current = sel.querySelector('option').outerHTML; // conserva la opción "todos" inicial
  sel.innerHTML = current + options.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
  if (options.includes(prevValue)) sel.value = prevValue;
}

function getFilteredSorted() {
  const q = document.getElementById('fBuscar').value.trim().toLowerCase();
  const empresa = document.getElementById('fEmpresa').value;
  const proyecto = document.getElementById('fProyecto').value;
  const proveedor = document.getElementById('fProveedor').value;
  let desde = document.getElementById('fDesde').value;
  let hasta = document.getElementById('fHasta').value;
  // Si solo se llena un extremo del rango, se interpreta como "ese día" y no
  // como un rango abierto (p. ej. solo "Desde" no debe arrastrar días previos).
  if (desde && !hasta) hasta = desde;
  if (hasta && !desde) desde = hasta;

  // En cuanto hay un buscador o filtro (texto, empresa, proyecto o proveedor)
  // activo, el calendario deja de restringir — se busca en todos los
  // registros, no solo en el rango de fechas que haya quedado puesto.
  const otroFiltroActivo = !!(q || empresa || proyecto || proveedor);

  let rows = entradas.filter(r => {
    if (empresa && r['Empresa'] !== empresa) return false;
    if (proyecto && r['Proyecto'] !== proyecto) return false;
    if (proveedor && r['Proveedor'] !== proveedor) return false;
    if (!otroFiltroActivo && (desde || hasta)) {
      const fechaIso = ddmmyyyyToIso(r['Fecha']);
      if (!fechaIso) return false;
      if (desde && fechaIso < desde) return false;
      if (hasta && fechaIso > hasta) return false;
    }
    if (q) {
      const haystack = [r['O.C.'], r['No. Parte'], r['Pedido / Reporte'], r['Descripción']]
        .join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const { col, dir } = sortState;

  // Orden por default (sin que el usuario haya tocado ningún encabezado):
  // de ORDEN_CAPTURA_DESDE en adelante, más nuevo primero por captura; antes
  // de esa fecha se conserva el orden de siempre (por Fecha), sin mezclarlos.
  if (col === '_sortKey') {
    const recientes = rows.filter(r => (ddmmyyyyToIso(r['Fecha']) ?? '') >= ORDEN_CAPTURA_DESDE);
    const anteriores = rows.filter(r => (ddmmyyyyToIso(r['Fecha']) ?? '') < ORDEN_CAPTURA_DESDE);
    recientes.sort(compararPorColumna('_sortKey', 'desc'));
    anteriores.sort(compararPorColumna('Fecha', 'desc'));
    return [...recientes, ...anteriores];
  }

  rows.sort(compararPorColumna(col, dir));
  return rows;
}

// Corte de la nueva regla de orden por captura — antes de esta fecha, la
// vista "Entradas" sigue ordenándose como siempre (por Fecha).
const ORDEN_CAPTURA_DESDE = '2026-07-17';

function compararPorColumna(col, dir) {
  return (a, b) => {
    let av = a[col] ?? '', bv = b[col] ?? '';
    if (col === 'Fecha') {
      av = ddmmyyyyToIso(av) ?? '';
      bv = ddmmyyyyToIso(bv) ?? '';
    } else {
      const an = Number(av), bn = Number(bv);
      if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== '' && bv !== '') { av = an; bv = bn; }
    }
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  };
}

function renderEntradas() {
  const wrap = document.getElementById('entradasWrap');
  const empty = document.getElementById('entradasEmpty');
  const count = document.getElementById('entradasCount');
  const pagination = document.getElementById('entradasPagination');
  const rows = getFilteredSorted();

  if (!rows.length) {
    count.textContent = entradas.length ? `Mostrando 0 de ${entradas.length} registro(s).` : '';
    wrap.classList.add('hidden');
    pagination.classList.add('hidden');
    empty.classList.remove('hidden');
    if (!entradasLoaded) {
      empty.classList.add('is-loading');
      empty.innerHTML = '<span class="spinner"></span> Cargando entradas…';
    } else {
      empty.classList.remove('is-loading');
      empty.textContent = entradas.length ? 'Ningún registro coincide con los filtros.' : 'Todavía no hay entradas registradas.';
    }
    return;
  }
  wrap.classList.remove('hidden');
  empty.classList.add('hidden');

  // Con miles de registros posibles, la tabla se pagina de 100 en 100 en vez
  // de meter todas las filas al DOM de un jalón.
  const totalPaginas = Math.max(1, Math.ceil(rows.length / REGISTROS_POR_PAGINA));
  if (paginaActual > totalPaginas) paginaActual = totalPaginas;
  const inicio = (paginaActual - 1) * REGISTROS_POR_PAGINA;
  const rowsPagina = rows.slice(inicio, inicio + REGISTROS_POR_PAGINA);

  count.textContent = `Mostrando ${inicio + 1}–${inicio + rowsPagina.length} de ${rows.length} registro(s).`;

  const cols = FIELDS.map(f => f.label);
  const head = `<tr>${cols.map(c => `<th class="sortable" data-col="${escapeHtml(c)}">${escapeHtml(c)}${sortArrow(c)}</th>`).join('')}</tr>`;
  const body = rowsPagina.map(r => {
    const cells = cols.map(c => {
      if (c === 'Estatus') return `<td>${estatusPill(r[c])}</td>`;
      if (c in LONG_TEXT_COLS) {
        const val = r[c] ?? '';
        return `<td class="td-clamp" style="max-width:${LONG_TEXT_COLS[c]}px" title="${escapeHtml(val)}"><span class="clamp-inner">${escapeHtml(val)}</span></td>`;
      }
      return `<td>${escapeHtml(r[c])}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  wrap.innerHTML = `<table>${head}${body}</table>`;
  wrap.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      sortState.dir = (sortState.col === col && sortState.dir === 'asc') ? 'desc' : 'asc';
      sortState.col = col;
      paginaActual = 1;
      renderEntradas();
    });
  });

  renderPaginacion(totalPaginas);
}

function renderPaginacion(totalPaginas) {
  const pagination = document.getElementById('entradasPagination');
  if (totalPaginas <= 1) {
    pagination.classList.add('hidden');
    pagination.innerHTML = '';
    return;
  }
  pagination.classList.remove('hidden');
  pagination.innerHTML = `
    <button class="tbtn" type="button" id="pagPrev" ${paginaActual === 1 ? 'disabled' : ''}>← Anterior</button>
    <span class="pag-info">Página ${paginaActual} de ${totalPaginas}</span>
    <button class="tbtn" type="button" id="pagNext" ${paginaActual === totalPaginas ? 'disabled' : ''}>Siguiente →</button>
  `;
  document.getElementById('pagPrev').addEventListener('click', () => {
    paginaActual--;
    renderEntradas();
  });
  document.getElementById('pagNext').addEventListener('click', () => {
    paginaActual++;
    renderEntradas();
  });
}

function sortArrow(col) {
  if (sortState.col !== col) return '';
  return `<span class="arrow">${sortState.dir === 'asc' ? '▲' : '▼'}</span>`;
}

function estatusPill(val) {
  const cls = String(val || '').toLowerCase();
  return `<span class="pill-estatus ${escapeHtml(cls)}">${escapeHtml(val || '—')}</span>`;
}

function exportCsv() {
  const rows = getFilteredSorted();
  if (!rows.length) {
    toast('No hay entradas para exportar con los filtros actuales.', 'err');
    return;
  }
  const cols = FIELDS.map(f => f.label);
  const escapeCsv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [cols.map(escapeCsv).join(',')];
  rows.forEach(r => lines.push(cols.map(c => escapeCsv(r[c])).join(',')));

  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `entradas-almacen-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Sufijo del nombre de archivo según el filtro de fecha activo: un día
// puntual ("Desde" == "Hasta"), un rango, o "todas" si no hay filtro.
function rangoArchivoSufijo() {
  const desde = document.getElementById('fDesde').value;
  const hasta = document.getElementById('fHasta').value;
  if (desde && hasta && desde === hasta) return desde;
  if (desde && hasta) return `${desde}_a_${hasta}`;
  if (desde) return `desde-${desde}`;
  if (hasta) return `hasta-${hasta}`;
  return 'todas';
}

// Columnas del Excel oficial FO-MBT-ALM-02 (hoja "Ingresado") — mismo orden,
// encabezados y anchos que el formato de control de documento ya en uso.
// "No. de entrada" se deja en blanco: es de solo lectura y hoy no se lee del
// endpoint hacia el modelo de datos de la app.
const EXCEL_TEMPLATE_COLUMNS = [
  { header: 'FECHA',            width: 15.29, get: r => r['Fecha'] },
  { header: 'No. de entrada',   width: 17.14, get: () => '' },
  { header: 'Estatus',          width: 20,    get: r => r['Estatus'] },
  { header: 'Texto libre',      width: 27.43, get: r => r['Correo electrónico'] },
  { header: 'Pedido / Reporte', width: 25.57, get: r => r['Pedido / Reporte'], align: 'left' },
  { header: 'O.C.',             width: 10,    get: r => r['O.C.'] },
  { header: 'Almacén',          width: 18.14, get: r => r['Almacén'] },
  { header: 'Descripción',      width: 49.43, get: r => r['Descripción'],  align: 'left' },
  { header: 'No. Parte',        width: 37,    get: r => r['No. Parte'],    align: 'left' },
  { header: 'Cantidad',         width: 12.71, get: r => r['Cantidad'] },
  { header: 'Proveedor',        width: 44.29, get: r => r['Proveedor'],    align: 'left' },
  { header: 'Proyecto',         width: 27.86, get: r => r['Proyecto'],     align: 'left' },
  { header: 'Comentario',       width: 23.57, get: r => r['Comentario'],   align: 'left' },
  { header: 'Empresa',          width: 21.14, get: r => r['Empresa'] },
];

async function exportExcel() {
  const rows = getFilteredSorted();
  if (!rows.length) {
    toast('No hay entradas para exportar con los filtros actuales.', 'err');
    return;
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Ingresado', {
    pageSetup: { orientation: 'landscape', scale: 35 },
  });
  ws.columns = EXCEL_TEMPLATE_COLUMNS.map(c => ({ width: c.width }));
  const lastCol = String.fromCharCode(65 + EXCEL_TEMPLATE_COLUMNS.length - 1); // 'N'

  const logoId = wb.addImage({ base64: 'data:image/png;base64,' + EXCEL_LOGO_BASE64, extension: 'png' });
  ws.addImage(logoId, { tl: { col: 1, row: 1 }, ext: { width: 150, height: 72 } });

  ws.mergeCells(`D2:${lastCol}5`);
  const title = ws.getCell('D2');
  title.value = 'FO-MBT-ALM-02 REPORTE DE ENTRADAS ALMACÉN';
  title.font = { bold: true, size: 16, name: 'Arial' };
  title.alignment = { vertical: 'middle', horizontal: 'right' };

  ws.mergeCells(`K6:${lastCol}6`);
  ws.getCell('K6').value = 'Clasificación: Sensible';
  ws.mergeCells(`L7:${lastCol}7`);
  ws.getCell('L7').value = 'Versión:03';
  ws.mergeCells(`M9:${lastCol}9`);
  ws.getCell('M9').value = 'Publicación: 14-Ene-2026';
  ['K6', 'L7', 'M9'].forEach(ref => {
    ws.getCell(ref).font = { size: 9, color: { argb: 'FF666666' }, name: 'Arial' };
    ws.getCell(ref).alignment = { horizontal: 'right' };
  });
  ws.getCell('M12').value = 'Fecha de revisión';
  ws.getCell('M12').font = { size: 9, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
  ws.getCell('M12').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A4274' } };
  ws.getCell('M12').alignment = { horizontal: 'center', vertical: 'center' };
  ws.getCell('N12').value = 'dd/mm/aaaa';
  ws.getCell('N12').font = { size: 9, italic: true, name: 'Arial' };
  ws.getCell('N12').alignment = { horizontal: 'center', vertical: 'center' };
  ws.getCell('N12').border = {
    top: { style: 'thin', color: { argb: 'FFBFBFBF' } },
    bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
    left: { style: 'thin', color: { argb: 'FFBFBFBF' } },
    right: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  };

  const headerRowIdx = 14;
  const headerRow = ws.getRow(headerRowIdx);
  EXCEL_TEMPLATE_COLUMNS.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { color: { argb: 'FFFFFFFF' }, size: 11, name: 'Arial' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A4274' } };
    cell.alignment = { horizontal: 'center', vertical: 'center' };
    cell.border = {
      left: { style: 'thin', color: { argb: 'FFBFBFBF' } },
      right: { style: 'thin', color: { argb: 'FFBFBFBF' } },
    };
  });

  rows.forEach((r, i) => {
    const row = ws.getRow(headerRowIdx + 1 + i);
    const band = i % 2 === 1;
    EXCEL_TEMPLATE_COLUMNS.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = c.get(r) ?? '';
      cell.font = { size: 11, name: 'Arial' };
      cell.alignment = { horizontal: c.align || 'center', vertical: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        right: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      };
      if (band) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    });
  });

  const footerRowIdx = headerRowIdx + 1 + rows.length + 1;
  ws.mergeCells(`A${footerRowIdx}:${lastCol}${footerRowIdx}`);
  const footer = ws.getCell(`A${footerRowIdx}`);
  footer.value = 'PROHIBIDA LA REPRODUCCIÓN TOTAL O PARCIAL DE ESTE DOCUMENTO SIN PREVIA AUTORIZACIÓN\n'
    + 'ESTE DOCUMENTO IMPRESO NO ES VÁLIDO YA QUE EL DOCUMENTO VIGENTE ES EL QUE SE ENCUENTRA EN EL SISTEMA INFORMÁTICO.';
  footer.font = { size: 8, italic: true, color: { argb: 'FF808080' }, name: 'Arial' };
  footer.alignment = { horizontal: 'center', wrapText: true };

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `entradas-almacen-${rangoArchivoSufijo()}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Endpoints ----------

function isUrlConfigured(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

function isCreateConfigured() {
  return isUrlConfigured(CONFIG.CREATE_ENDPOINT);
}

function isReadConfigured() {
  return isUrlConfigured(CONFIG.READ_ENDPOINT);
}

// ---------- Tema ----------

const THEMES = ['dark', 'blue-dark', 'light', 'gray'];

function initTheme() {
  const saved = localStorage.getItem(STORAGE_THEME) || 'light';
  setTheme(saved);
}

function setTheme(t) {
  if (!THEMES.includes(t)) t = 'dark';
  document.documentElement.setAttribute('data-theme', t === 'dark' ? '' : t);
  localStorage.setItem(STORAGE_THEME, t);
  THEMES.forEach(k => {
    document.getElementById('th-' + k)?.classList.toggle('active', k === t);
  });
  document.getElementById('themePanel').classList.add('hidden');
}

// ---------- Fecha del día (topbar, portal y footer) ----------

const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_L = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function fechaLargaHoy() {
  const now = new Date();
  const dia = DIAS_L[now.getDay()];
  return `${dia.charAt(0).toUpperCase() + dia.slice(1)}, ${now.getDate()} de ${MESES_L[now.getMonth()]} de ${now.getFullYear()}`;
}

function showTodayDate() {
  const hoy = fechaLargaHoy();
  const topbarDate = document.getElementById('todayDate');
  if (topbarDate) topbarDate.textContent = hoy;
  const footerText = document.getElementById('footerText');
  if (footerText) footerText.textContent = `Entradas Almacén ${new Date().getFullYear()} — Mainbit · © Mainbit. Todos los derechos reservados.`;
}

// ---------- Utilidades ----------

let toastTimer;
function toast(msg, kind, duracion = 4000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + (kind === 'err' ? 'err' : 'ok');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, duracion);
}

function showModal(msg) {
  document.getElementById('successModalMsg').textContent = msg;
  document.getElementById('successModal').classList.remove('hidden');
  requestAnimationFrame(() => document.getElementById('successModal').classList.add('show'));
}

function hideModal() {
  document.getElementById('successModal').classList.remove('show');
}

// Aviso de una sola vez (por navegador) para que los usuarios nuevos sepan
// que pueden cambiar el tema — con los puntitos junto al logo.
function mostrarAvisoTema() {
  if (localStorage.getItem(STORAGE_THEME_HINT)) return;
  localStorage.setItem(STORAGE_THEME_HINT, '1');
  setTimeout(() => {
    const hint = document.getElementById('themeHint');
    hint.classList.remove('hidden');
    setTimeout(() => hint.classList.add('hidden'), 7000);
  }, 1200);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
