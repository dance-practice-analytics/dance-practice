// FR-3.6.5: per-subject summary of the study dataset (medians over each subject's own
// processed clips, with how many were counted or left out for low confidence). Neutral
// numbers in subject-code order; no ranking, no colour for "more" or "less".

import { useMemo } from 'react'
import type { MovementType } from '../../../data/schema'
import { Icon } from '../../components'
import type { AttemptView } from '../../data'
import { formatMetricWithUnit, METRICS, metricsFor, MOVEMENT_LABELS } from '../../format'
import { fileDay, saveText } from '../settings/download'
import { subjectAggregates, subjectSummaryCsv, type MetricAggregate } from './aggregate'
import { MOVEMENT_ORDER } from './grid'

function Counts({ m }: { m: MetricAggregate }) {
  const parts = [`n = ${m.counted}`]
  if (m.excludedLow) parts.push(`${m.excludedLow} low conf. left out`)
  if (m.unavailable) parts.push(`${m.unavailable} no value`)
  return <span className="t-caption">{parts.join(' · ')}</span>
}

export function SubjectSummary({ attempts, onSaved }: { attempts: readonly AttemptView[]; onSaved(message: string): void }) {
  const aggregates = useMemo(() => subjectAggregates(attempts), [attempts])
  const movements = MOVEMENT_ORDER.filter((m) => aggregates.some((g) => g.movement === m))

  const save = () => {
    const name = `study-dataset-subjects-${fileDay()}.csv`
    saveText(name, subjectSummaryCsv(aggregates), 'text/csv;charset=utf-8')
    onSaved(`Saved ${name}: ${aggregates.length} ${aggregates.length === 1 ? 'row' : 'rows'}, one per subject and movement.`)
  }

  return (
    <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }} aria-labelledby="subj-sum-h">
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <h2 className="t-h3" id="subj-sum-h">
          Per-subject summary
        </h2>
        <button className="btn btn-secondary btn-sm" type="button" onClick={save} disabled={aggregates.length === 0}>
          <Icon name="download" />
          Export summary CSV
        </button>
      </div>
      <p className="t-caption">
        Median of each subject’s own processed clips. Values with low tracking confidence are left out of the median and counted
        separately; clips without a value are counted too. Subjects are listed by code and are not compared with each other.
      </p>
      {aggregates.length === 0 ? (
        <p className="t-small muted">No study clip has been processed yet.</p>
      ) : (
        movements.map((movement: MovementType) => {
          const keys = metricsFor(movement)
          const rows = aggregates.filter((g) => g.movement === movement)
          return (
            <div className="tbl-wrap" key={movement}>
              <table className="tbl">
                <caption className="t-label" style={{ textAlign: 'left', padding: '4px 0 8px' }}>
                  {MOVEMENT_LABELS[movement]}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Subject</th>
                    <th scope="col">Clips done</th>
                    {keys.map((k) => (
                      <th scope="col" key={k}>
                        {METRICS[k].label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((g) => (
                    <tr key={`${g.code}-${movement}`}>
                      <th scope="row" className="mono">
                        {g.code}
                      </th>
                      <td className="num">{g.attempts}</td>
                      {g.metrics.map((m) => (
                        <td key={m.metric}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span className="mono">{m.median === null ? '—' : formatMetricWithUnit(m.metric, m.median)}</span>
                            <Counts m={m} />
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })
      )}
    </section>
  )
}
