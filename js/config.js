// Configuración del sistema de Entradas de Almacén (FO-MBT-ALM-02)
// Nombres de campo y formato de payload alineados al JSON real de la lista
// SharePoint "almacen" (visto vía el conector de Power Automate).

const CONFIG = {
  // Flujo de SOLO LECTURA (Get items) — alimenta la vista "Entradas". Ya probado
  // y funcionando: responde 200 con el arreglo completo de la lista.
  READ_ENDPOINT: 'https://default68cc1881aa5d42129424c3f93b54cf.76.environment.api.powerplatform.com/powerautomate/automations/direct/cu/21/workflows/4ddba2f8b5b44d5485296297e1b01427/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=j4rnNLnUvj_dVN5JazOvr8TFJBFzClAsuTDYIsLcsLs',

  // Flujo de CREACIÓN (Create item) — usado por el formulario "Registrar".
  // Pega aquí la URL del nuevo flujo dedicado a crear elementos (ver guía paso a
  // paso). Mientras no sea una URL http(s) válida, el formulario sigue en modo
  // simulación (solo guarda en este navegador).
  CREATE_ENDPOINT: 'https://default68cc1881aa5d42129424c3f93b54cf.76.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/03/workflows/9a3eaafa5d3644dbbbe9ed8aeae87e53/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=QYnADUDJ7xO1cK9gSFcu8K55lhjxsdQrD7PWskDo-1k',

  // El "Get items" de la lista devuelve Estatus/Almacen/Empresa como objeto:
  // { "@odata.type": "#Microsoft.Azure.Connectors.SharePoint.SPListExpandedReference", "Id": 0, "Value": "COMPLETA" }.
  // Pero la acción "Crear elemento" de SharePoint en Power Automate espera el
  // valor plano (solo el texto) para columnas de selección — por eso en false.
  SEND_CHOICE_AS_OBJECT: false,

  // Catálogos de los campos tipo selector — confirmados contra los valores
  // reales presentes en la lista "almacen" (2584 registros migrados).
  ESTATUS: ['COMPLETA', 'PARCIAL', 'PENDIENTE', 'CANCELADA'],
  ALMACEN: ['GEN', 'REFAC', '1', 'EQCOMPUT'],
  EMPRESA: [
    'MAINBIT',
    'INNOVATION, BUSINESS AND INFRASTRUCTURES IN TECHNOLOGY',
    'CABO DE PEÑAS EDIFICIOS Y TERRENOS',
    'ADELANTE TECHNOLOGY',
    'CLOUD DATA PROCESSING AND STORAGE',
    'INNBIT',
    'MAIN BUSINESS SOLUTIONS',
    'SECURITY ONE',
  ],
};

const CHOICE_ODATA_TYPE = '#Microsoft.Azure.Connectors.SharePoint.SPListExpandedReference';

// Definición de los campos del formulario.
// `label`  → texto visible en la UI y llave usada en el historial/CSV locales.
// `key`    → nombre interno de la columna en SharePoint, usado al armar el payload.
// `choice` → columnas de selección (Choice) que SharePoint expone como objeto.
//
// Nota: la lista sí tiene columna "No. de entrada" (No_x002e__x0020_de_x0020_entrada),
// pero es de solo lectura (no aparece como parámetro editable en "Crear elemento"),
// así que de momento no se captura desde el formulario.
//
// Ojo: "Fecha" en esta lista es texto libre en formato DD/MM/AAAA (no una columna
// de fecha real) — por eso se convierte a/desde ISO al leer/enviar (ver app.js).
const FIELDS = [
  { id: 'fecha', key: 'Fecha', label: 'Fecha', type: 'date', required: true },
  { id: 'estatus', key: 'Estatus', label: 'Estatus', type: 'select', options: CONFIG.ESTATUS, required: true, choice: true },
  { id: 'textoLibre', key: 'texto_libre', label: 'Correo electrónico', type: 'text' },
  { id: 'pedidoReporte', key: 'pedido_reporte', label: 'Pedido / Reporte', type: 'text' },
  { id: 'oc', key: 'oc', label: 'O.C.', type: 'number' },
  { id: 'almacen', key: 'almacen', label: 'Almacén', type: 'combo', options: CONFIG.ALMACEN, required: true, choice: true },
  { id: 'descripcion', key: 'descripcion', label: 'Descripción', type: 'text', required: true, full: true },
  { id: 'noParte', key: 'No_parte', label: 'No. Parte', type: 'text' },
  { id: 'cantidad', key: 'cantidad', label: 'Cantidad', type: 'number', required: true },
  { id: 'proveedor', key: 'proveedor', label: 'Proveedor', type: 'text' },
  { id: 'proyecto', key: 'proyecto', label: 'Proyecto', type: 'text' },
  { id: 'comentario', key: 'comentario', label: 'Comentario', type: 'textarea', full: true, emptyValue: 'Sin comentarios' },
  { id: 'empresa', key: 'empresa', label: 'Empresa', type: 'combo', options: CONFIG.EMPRESA, required: true, choice: true },
];
