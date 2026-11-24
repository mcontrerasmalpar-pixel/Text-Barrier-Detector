import { countSpanishSyllables } from '../syllables.js';
import { detectSpanishPassive } from '../passive/es.js';
import type { LanguagePack } from './types.js';

/** Common multi-syllable Spanish product/tech words that are not barriers. */
const COMMON_TECHNICAL = new Set(
  [
    'información', 'comunicación', 'tecnología', 'aplicación', 'desarrollo',
    'organización', 'infraestructura', 'configuración', 'documentación',
    'implementación', 'funcionalidad', 'disponibilidad', 'confiabilidad',
    'compatibilidad', 'integración', 'autenticación', 'autorización',
    'entorno', 'rendimiento', 'experiencia', 'interfaz', 'repositorio',
    'componente', 'parámetro', 'operación', 'administración', 'seguridad',
    'análisis', 'evaluación', 'cálculo', 'generación', 'distribución',
    'colaboración', 'notificación', 'suscripción', 'accesibilidad',
    'escalabilidad', 'optimización', 'visualización', 'algoritmo',
    'software', 'hardware', 'protocolo', 'framework', 'biblioteca', 'módulo',
    'servicio', 'proceso', 'sistema', 'usuario', 'usuarios', 'cuenta',
    'cuentas', 'ajustes', 'opciones', 'características', 'producto',
    'productos', 'versión', 'versiones', 'actualización', 'actualizaciones',
    'error', 'errores', 'mensaje', 'mensajes', 'informe', 'informes',
    'archivo', 'archivos', 'carpeta', 'carpetas', 'documento', 'documentos',
    'página', 'páginas', 'sección', 'secciones', 'capítulo', 'capítulos',
    'artículo', 'artículos', 'contenido', 'contenidos', 'texto', 'textos',
    'idioma', 'idiomas', 'ejemplo', 'ejemplos', 'tutorial', 'tutoriales',
    'guía', 'guías', 'manual', 'manuales', 'referencia', 'referencias',
    'descripción', 'descripciones', 'resumen', 'resúmenes', 'introducción',
    'conclusión', 'conclusiones', 'recomendación', 'recomendaciones',
    'requisito', 'requisitos', 'especificación', 'especificaciones',
    'limitación', 'limitaciones', 'ventaja', 'ventajas', 'desventaja',
    'desventajas', 'beneficio', 'beneficios', 'desafío', 'desafíos',
    'solución', 'soluciones', 'problema', 'problemas', 'pregunta',
    'preguntas', 'respuesta', 'respuestas', 'solicitud', 'solicitudes',
    'resultado', 'resultados', 'impacto', 'impactos', 'efecto', 'efectos',
    'causa', 'causas', 'razón', 'razones', 'propósito', 'propósitos',
    'objetivo', 'objetivos', 'estrategia', 'estrategias', 'método', 'métodos',
    'enfoque', 'enfoques', 'técnica', 'técnicas', 'procedimiento',
    'procedimientos', 'flujo', 'flujos', 'arquitectura', 'arquitecturas',
    'diseño', 'diseños', 'patrón', 'patrones', 'modelo', 'modelos',
    'estructura', 'estructuras', 'formato', 'formatos', 'estándar',
    'estándares', 'política', 'políticas', 'directriz', 'directrices',
    'práctica', 'prácticas',
  ].map((w) => w.toLowerCase())
);

/**
 * Fernández-Huerta (1959): L = 206.84 - 0.60 * P - 1.02 * F
 * where P = syllables per 100 words (100 * syllables / words)
 * and   F = average words per sentence (words / sentences).
 */
function readingEase(words: number, sentences: number, syllables: number): number {
  const P = (syllables / words) * 100;
  const F = words / sentences;
  return 206.84 - 0.60 * P - 1.02 * F;
}

/**
 * INFLESZ / Szigriszt-Pazos (1993) perspicuity index for Spanish:
 * I = 206.835 - 62.3 * (syllables / words) - (words / sentences).
 * Clamped to [0, 100] with the Barrio-Cantalejo INFLESZ scale label.
 */
export function computeInflesz(
  words: number,
  sentences: number,
  syllables: number
): { score: number; label: string } {
  if (words <= 0 || sentences <= 0) {
    return { score: 0, label: 'Muy difícil' };
  }
  const raw = 206.835 - 62.3 * (syllables / words) - words / sentences;
  const score = Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10;
  let label: string;
  if (score >= 80) label = 'Muy fácil';
  else if (score >= 65) label = 'Bastante fácil';
  else if (score >= 55) label = 'Normal';
  else if (score >= 40) label = 'Algo difícil';
  else label = 'Muy difícil';
  return { score, label };
}

export const esPack: LanguagePack = {
  code: 'es',
  formulaName: 'Fernández-Huerta',
  wordCharsRe: /[^a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]/g,
  countSyllables: countSpanishSyllables,
  isPassive: detectSpanishPassive,
  isCommonTechnical: (word) => COMMON_TECHNICAL.has(word.toLowerCase()),
  complexWordMinSyllables: 4,
  readingEase,
};
