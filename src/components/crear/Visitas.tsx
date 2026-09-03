import type { ResumenDeVisitas } from '../../lib/publicar'
import { duracion } from '../../lib/metricas/formato'

/**
 * Las visitas de la casa publicada, como las lee un agente: cuántas, qué cuartos
 * les importaron y cuánto se quedaron, qué puntos tocaron. La gráfica que vende,
 * en texto: con dos a doce habitaciones una lista ordenada dice más que una
 * barra, y no cuesta ni un byte de librería.
 *
 * La comparten la hoja del editor (`EditorRecorrido`) y el panel de la
 * inmobiliaria (`Panel`): la misma cuenta, leída igual en los dos sitios.
 */
export function ResumenVisitas({
  resumen,
  ultimos7,
  nombres,
}: {
  resumen: ResumenDeVisitas
  /** Calculado al pedir las visitas, no al pintar: leer el reloj en el render es impuro. */
  ultimos7: number
  nombres: Record<string, string>
}) {
  const nombre = (id: string) => nombres[id] ?? id
  const escenas = Object.entries(resumen.escenas).sort(
    (a, b) => b[1].visitas - a[1].visitas || b[1].segundos - a[1].segundos,
  )
  const puntos = Object.entries(resumen.puntos)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div>
        <p className="text-3xl font-bold text-ink-50">
          {resumen.visitas} {resumen.visitas === 1 ? 'visita' : 'visitas'}
        </p>
        <p className="text-ink-200">
          {ultimos7} en los últimos 7 días · {resumen.aparatos.modestos} en teléfonos modestos
          {resumen.fallas
            ? ` · ${resumen.fallas} ${resumen.fallas === 1 ? 'vez' : 'veces'} no cargó una foto`
            : ''}
        </p>
      </div>
      {escenas.length > 0 && (
        <div>
          <p className="mb-2 font-semibold">Qué cuartos les importaron</p>
          <ul className="flex flex-col gap-1">
            {escenas.map(([id, e]) => (
              <li key={id} className="flex justify-between gap-3">
                <span className="truncate">{nombre(id)}</span>
                <span className="shrink-0 text-ink-200">
                  {e.visitas} · {duracion(e.segundos / Math.max(1, e.visitas))} cada uno
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {puntos.length > 0 && (
        <div>
          <p className="mb-2 font-semibold">Puntos que tocaron</p>
          <ul className="flex flex-col gap-1">
            {puntos.map(([id, n]) => (
              <li key={id} className="flex justify-between gap-3">
                <span className="truncate">{nombre(id)}</span>
                <span className="shrink-0 text-ink-200">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-ink-200/70">
        Se cuentan sesiones, no personas: sin cookies ni huella del navegador, y el servidor no
        guarda la dirección IP. Quien tenga activado "no rastrear" no aparece.
      </p>
      {!resumen.completos && (
        <p className="text-xs text-amber-300">
          Hay más visitas de las que se pudieron sumar: el número real es mayor.
        </p>
      )}
    </div>
  )
}
