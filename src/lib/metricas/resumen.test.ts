import { describe, expect, it } from 'vitest'

import { TOPE_ESTANCIA_MS, resumir, visitasRecientes, type PaqueteCrudo } from './resumen'

/**
 * ============================================================================
 *  EL RESUMEN DE LAS VISITAS
 * ============================================================================
 *
 * Lo que un agente lee en "Visitas" sale de aquí, así que las reglas de la
 * cuenta se prueban una por una: una sesión es una visita aunque mande varios
 * paquetes; el tiempo en un cuarto va de su `escena` a la siguiente o al `fin`;
 * una pestaña olvidada no es una visita de dos horas; y la basura no cuenta.
 */

const paquete = (s: string, inicio: number, eventos: PaqueteCrudo['eventos']): PaqueteCrudo => ({
  v: 1,
  s,
  inicio,
  eventos,
})

const T0 = Date.UTC(2026, 8, 3, 15, 0, 0) // 2026-09-03 15:00 UTC

describe('resumir', () => {
  it('una sesión con varios paquetes es UNA visita', () => {
    const r = resumir([
      paquete('aaaaaaaaaaaa', T0, [{ e: 'abrir', t: 0, aparato: 'normal' }, { e: 'escena', t: 100, id: 'sala' }, { e: 'fin', t: 5000 }]),
      paquete('aaaaaaaaaaaa', T0 + 5000, [{ e: 'escena', t: 0, id: 'cocina' }, { e: 'fin', t: 3000 }]),
      paquete('bbbbbbbbbbbb', T0 + 60_000, [{ e: 'abrir', t: 0, aparato: 'modesto', tactil: true }, { e: 'escena', t: 0, id: 'sala' }, { e: 'fin', t: 2000 }]),
    ])
    expect(r.visitas).toBe(2)
    expect(r.porDia['2026-09-03']).toBe(2)
    expect(r.aparatos).toEqual({ modestos: 1, normales: 1, tactiles: 1 })
  })

  it('el tiempo en un cuarto va de su escena a la siguiente, o al fin del paquete', () => {
    const r = resumir([
      paquete('aaaaaaaaaaaa', T0, [
        { e: 'escena', t: 0, id: 'sala' },
        { e: 'escena', t: 4000, id: 'cocina' },
        { e: 'fin', t: 10_000 },
      ]),
    ])
    expect(r.escenas.sala).toEqual({ visitas: 1, segundos: 4 })
    expect(r.escenas.cocina).toEqual({ visitas: 1, segundos: 6 })
  })

  it('los paquetes de una sesión se encadenan: el último cuarto sigue abierto hasta el siguiente paquete', () => {
    /* El primer paquete sale con la pestaña escondida a los 5 s; la persona
       vuelve y cambia de cuarto a los 8 s. La sala duró 8 s, no 5. */
    const r = resumir([
      paquete('aaaaaaaaaaaa', T0, [{ e: 'escena', t: 0, id: 'sala' }, { e: 'fin', t: 5000 }]),
      paquete('aaaaaaaaaaaa', T0 + 8000, [{ e: 'escena', t: 0, id: 'cocina' }, { e: 'fin', t: 2000 }]),
    ])
    expect(r.escenas.sala.segundos).toBe(8)
    expect(r.escenas.cocina.segundos).toBe(2)
  })

  it('una pestaña olvidada no es una visita de dos horas: tope por cuarto', () => {
    const r = resumir([
      paquete('aaaaaaaaaaaa', T0, [{ e: 'escena', t: 0, id: 'sala' }, { e: 'fin', t: 2 * 60 * 60 * 1000 }]),
    ])
    expect(r.escenas.sala.segundos).toBe(TOPE_ESTANCIA_MS / 1000)
  })

  it('volver al mismo cuarto no lo cuenta dos veces como visitado, pero sí suma su tiempo', () => {
    const r = resumir([
      paquete('aaaaaaaaaaaa', T0, [
        { e: 'escena', t: 0, id: 'sala' },
        { e: 'escena', t: 1000, id: 'cocina' },
        { e: 'escena', t: 2000, id: 'sala' },
        { e: 'fin', t: 5000 },
      ]),
    ])
    expect(r.escenas.sala).toEqual({ visitas: 1, segundos: 4 })
  })

  it('cuenta puntos y fallas', () => {
    const r = resumir([
      paquete('aaaaaaaaaaaa', T0, [
        { e: 'escena', t: 0, id: 'sala' },
        { e: 'punto', t: 500, id: 'p1', kind: 'link' },
        { e: 'punto', t: 900, id: 'p1', kind: 'link' },
        { e: 'punto', t: 950, id: 'p2', kind: 'info' },
        { e: 'falla', t: 1000, que: 'Cocina' },
        { e: 'fin', t: 1100 },
      ]),
    ])
    expect(r.puntos).toEqual({ p1: 2, p2: 1 })
    expect(r.fallas).toBe(1)
  })

  it('la basura no cuenta: paquetes sin sesión, eventos sin tiempo, tipos desconocidos', () => {
    const r = resumir([
      { s: 'aaaaaaaaaaaa', inicio: T0, eventos: [{ e: 'escena', t: 0, id: 'sala' }, { e: 'baile', t: 10 }, { e: 'escena', t: Number.NaN, id: 'x' }, { e: 'fin', t: 1000 }] },
      { s: 42, inicio: T0, eventos: [] } as unknown as PaqueteCrudo,
      { s: 'bbbbbbbbbbbb', inicio: 'ayer', eventos: [] } as unknown as PaqueteCrudo,
      null as unknown as PaqueteCrudo,
    ])
    expect(r.visitas).toBe(1)
    expect(Object.keys(r.escenas)).toEqual(['sala'])
    expect(r.escenas.sala.segundos).toBe(1)
  })

  it('los últimos siete días se cuentan desde la fecha que se le da, no desde el reloj', () => {
    const porDia = { '2026-09-03': 2, '2026-09-01': 1, '2026-08-28': 5, '2026-08-27': 9 }
    // Del 28 de agosto al 3 de septiembre son siete días: el 27 queda fuera.
    expect(visitasRecientes(porDia, T0)).toBe(8)
    expect(visitasRecientes(porDia, T0, 1)).toBe(2)
    expect(visitasRecientes({}, T0)).toBe(0)
  })

  it('sin paquetes, todo en cero y sin fechas', () => {
    const r = resumir([])
    expect(r).toEqual({
      visitas: 0,
      porDia: {},
      escenas: {},
      puntos: {},
      aparatos: { modestos: 0, normales: 0, tactiles: 0 },
      fallas: 0,
      desde: null,
      hasta: null,
    })
  })
})
