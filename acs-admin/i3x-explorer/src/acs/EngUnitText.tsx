/*
 * ACS Admin
 * An engineering unit shown after a value
 * Copyright 2026 University of Sheffield
 *
 * The UNECE code is in the tooltip. Nothing is shown when there is no unit.
 * See engUnit.ts.
 */

import { engUnitTitle, useEngUnit, type EngUnit } from './engUnit'

export function EngUnitText({ unit, className = '' }: { unit: EngUnit | null; className?: string }) {
  if (!unit) return null
  return (
    <span data-eng-unit="" title={engUnitTitle(unit)} className={`font-sans font-normal text-i3x-text-muted ${className}`}>
      {unit.symbol}
    </span>
  )
}

/** An element's unit, looked up by its id. */
export function ElementEngUnit({ elementId, className = '' }: { elementId: string; className?: string }) {
  return <EngUnitText unit={useEngUnit(elementId)} className={className} />
}
