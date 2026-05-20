'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { apiGet, apiPost, apiPut, apiDelete } from '../../../../../lib/api'

export default function LayoutEditorPage() {
  const params = useParams()
  const restaurantId = params.id
  const t = useTranslations('sectionOps')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sections, setSections] = useState([])
  const [activeSection, setActiveSection] = useState(null)
  const [showAddSection, setShowAddSection] = useState(false)
  const [showTableForm, setShowTableForm] = useState(false)
  const [selectedCell, setSelectedCell] = useState(null)
  // Tier F commit 2: per-section ops modals (Edit grid / Delete section).
  const [editingSection, setEditingSection] = useState(null)
  const [deletingSection, setDeletingSection] = useState(null)

  const [newSection, setNewSection] = useState({
    nameRo: '',
    nameEn: '',
    gridRows: 4,
    gridColumns: 4,
  })

  const [tableForm, setTableForm] = useState({
    tableNumber: '',
    seatCount: 2,
  })

  useEffect(() => {
    fetchRestaurant()
  }, [restaurantId])

  const fetchRestaurant = async () => {
    try {
      setLoading(true)
      const data = await apiGet(`/api/admin/restaurants/${restaurantId}`)
      setSections(data.tableSections || [])
      if (data.tableSections && data.tableSections.length > 0) {
        setActiveSection(data.tableSections[0].id)
      }
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleAddSection = async () => {
    if (!newSection.nameRo || !newSection.nameEn) {
      alert('Please fill in all section fields')
      return
    }

    try {
      const section = await apiPost(`/api/admin/restaurants/${restaurantId}/sections`, newSection)
      setSections([...sections, section])
      setActiveSection(section.id)
      setNewSection({ nameRo: '', nameEn: '', gridRows: 4, gridColumns: 4 })
      setShowAddSection(false)
    } catch (err) {
      setError(err.message)
    }
  }

  const handleAddTable = async () => {
    if (!tableForm.tableNumber || !selectedCell) return

    try {
      const newTable = await apiPost(
        `/api/admin/sections/${activeSection}/tables`,
        {
          tableNumber: tableForm.tableNumber,
          seatCount: tableForm.seatCount,
          gridRow: selectedCell.row,
          gridCol: selectedCell.col,
        }
      )

      setSections(
        sections.map((s) =>
          s.id === activeSection
            ? {
                ...s,
                tables: [...(s.tables || []), newTable],
              }
            : s
        )
      )

      setShowTableForm(false)
      setSelectedCell(null)
      setTableForm({ tableNumber: '', seatCount: 2 })
    } catch (err) {
      setError(err.message)
    }
  }

  // Tier F2: Edit grid + Delete section. Both API paths surface
  // structured 409 errors (shrink-orphans-tables / section-has-reservations).
  // api.js attaches the parsed JSON to err.payload so we can pull
  // sampleTables / count without a second round-trip.
  const handleSaveGrid = async (section, gridRows, gridColumns) => {
    try {
      const updated = await apiPut(`/api/admin/sections/${section.id}`, { gridRows, gridColumns })
      setSections((prev) => prev.map((s) => (s.id === section.id ? { ...s, ...updated } : s)))
      setEditingSection(null)
      return null
    } catch (err) {
      if (err.payload?.error?.code === 'shrink-orphans-tables') {
        const samples = (err.payload.error.sampleTables || []).map((o) => o.tableNumber).join(', ') || '—'
        return t('shrinkError', { count: err.payload.error.orphanCount ?? '?', samples })
      }
      return err.message || t('errorGeneric')
    }
  }

  const handleDeleteSection = async (section) => {
    try {
      await apiDelete(`/api/admin/sections/${section.id}`)
      setSections((prev) => prev.filter((s) => s.id !== section.id))
      if (activeSection === section.id) {
        setActiveSection(sections.find((s) => s.id !== section.id)?.id || null)
      }
      setDeletingSection(null)
      return null
    } catch (err) {
      if (err.payload?.error?.code === 'section-has-reservations') {
        return t('deleteBlocked', { count: err.payload.error.count ?? '?' })
      }
      return err.message || t('errorGeneric')
    }
  }

  const handleDeleteTable = async (tableId, skipConfirm = false) => {
    if (!skipConfirm && !confirm('Delete this table?')) return

    try {
      console.log('Deleting table with ID:', tableId)
      await apiDelete(`/api/admin/tables/${tableId}`)
      setSections(
        sections.map((s) =>
          s.id === activeSection
            ? {
                ...s,
                tables: s.tables.filter((t) => t.id !== tableId),
              }
            : s
        )
      )
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) {
    return <div className="text-center py-12">Loading...</div>
  }

  const currentSection = sections.find((s) => s.id === activeSection)

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-800">Table Layout Editor</h1>
        <button
          onClick={() => setShowAddSection(!showAddSection)}
          className="bg-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-dark transition-colors"
        >
          + Add Section
        </button>
      </div>

      {error && (
        <div className="p-4 bg-alert-error-bg border border-alert-error-border text-alert-error-fg rounded">
          Error: {error}
        </div>
      )}

      {showAddSection && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">New Section</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Name (RO)</label>
              <input
                type="text"
                value={newSection.nameRo}
                onChange={(e) => setNewSection({ ...newSection, nameRo: e.target.value })}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Name (EN)</label>
              <input
                type="text"
                value={newSection.nameEn}
                onChange={(e) => setNewSection({ ...newSection, nameEn: e.target.value })}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Grid Rows</label>
              <input
                type="number"
                value={newSection.gridRows}
                onChange={(e) => setNewSection({ ...newSection, gridRows: parseInt(e.target.value) })}
                min="1"
                max="20"
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Grid Columns</label>
              <input
                type="number"
                value={newSection.gridColumns}
                onChange={(e) =>
                  setNewSection({ ...newSection, gridColumns: parseInt(e.target.value) })
                }
                min="1"
                max="20"
                className="w-full"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleAddSection}
              className="bg-primary text-white px-4 py-2 rounded hover:bg-primary-dark transition-colors"
            >
              Create Section
            </button>
            <button
              onClick={() => setShowAddSection(false)}
              className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Edit-grid modal (Tier F2) */}
      {editingSection && (
        <EditGridModal
          section={editingSection}
          onCancel={() => setEditingSection(null)}
          onSave={handleSaveGrid}
        />
      )}

      {/* Delete-section confirmation modal (Tier F2) */}
      {deletingSection && (
        <DeleteSectionModal
          section={deletingSection}
          onCancel={() => setDeletingSection(null)}
          onDelete={handleDeleteSection}
        />
      )}

      {sections.length > 0 && (
        <div className="space-y-6">
          {/* Section Tabs */}
          <div className="flex gap-2 border-b border-gray-300">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`px-4 py-2 font-medium transition-colors border-b-2 ${
                  activeSection === section.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-600 hover:text-gray-800'
                }`}
              >
                {section.nameEn || section.nameRo}
              </button>
            ))}
          </div>

          {/* Grid Editor */}
          {currentSection && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-gray-800">
                  {currentSection.nameEn || currentSection.nameRo}
                  <span className="ml-2 text-xs text-gray-500 font-normal">
                    {currentSection.gridRows}×{currentSection.gridColumns}
                  </span>
                </h2>
                {/* Tier F2 — per-section ops */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingSection(currentSection)}
                    className="text-sm px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    ✏️ {t('editGridButton')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingSection(currentSection)}
                    className="text-sm px-3 py-1.5 rounded border border-red-300 text-red-700 hover:bg-red-50"
                  >
                    🗑 {t('deleteSectionButton')}
                  </button>
                </div>
              </div>

              {showTableForm && selectedCell && (
                <div className="mb-6 p-4 border border-primary rounded-lg bg-primary-bg">
                  <h3 className="font-semibold text-gray-800 mb-3">
                    Add table to row {selectedCell.row + 1}, column {selectedCell.col + 1}
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Table Number
                      </label>
                      <input
                        type="text"
                        value={tableForm.tableNumber}
                        onChange={(e) =>
                          setTableForm({ ...tableForm, tableNumber: e.target.value })
                        }
                        placeholder="e.g., T1, A1"
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Seat Count
                      </label>
                      <input
                        type="number"
                        value={tableForm.seatCount}
                        onChange={(e) =>
                          setTableForm({ ...tableForm, seatCount: parseInt(e.target.value) })
                        }
                        min="1"
                        className="w-full"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={handleAddTable}
                      className="bg-primary text-white px-4 py-2 rounded hover:bg-primary-dark transition-colors"
                    >
                      Create Table
                    </button>
                    <button
                      onClick={() => {
                        setShowTableForm(false)
                        setSelectedCell(null)
                        setTableForm({ tableNumber: '', seatCount: 2 })
                      }}
                      className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${currentSection.gridColumns}, minmax(0, 1fr))`,
                  gap: '8px',
                }}
              >
                {Array.from({ length: currentSection.gridRows }).map((_, row) =>
                  Array.from({ length: currentSection.gridColumns }).map((_, col) => {
                    const table = currentSection.tables?.find(
                      (t) => t.gridRow === row && t.gridCol === col
                    )

                    return (
                      <div
                        key={`${row}-${col}`}
                        onClick={() => {
                          if (!table) {
                            setSelectedCell({ row, col })
                            setShowTableForm(true)
                          }
                        }}
                        className={`grid-cell relative ${table ? 'filled' : ''}`}
                      >
                        {table ? (
                          <div
                            className="text-center cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation()
                              const action = confirm(
                                `Delete ${table.tableNumber}?`
                              )
                              if (action) {
                                handleDeleteTable(table.id, true)
                              }
                            }}
                          >
                            <div className="font-semibold text-sm text-green-800">
                              {table.tableNumber}
                            </div>
                            <div className="text-xs text-green-700">{table.seatCount} seats</div>
                          </div>
                        ) : (
                          <div className="text-gray-400 text-lg cursor-pointer hover:text-gray-600">
                            +
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>

              {(!currentSection.tables || currentSection.tables.length === 0) && (
                <p className="text-center text-gray-500 mt-8">
                  Click any cell to add a table
                </p>
              )}

              {currentSection.tables && currentSection.tables.length > 0 && (
                <div className="mt-8">
                  <h3 className="font-semibold text-gray-800 mb-3">Tables in this section:</h3>
                  <ul className="space-y-2">
                    {currentSection.tables.map((table) => (
                      <li
                        key={table.id}
                        className="flex justify-between items-center p-2 bg-green-50 rounded border border-green-200"
                      >
                        <span className="font-medium text-gray-800">
                          {table.tableNumber} ({table.seatCount} seats)
                        </span>
                        <button
                          onClick={() => handleDeleteTable(table.id)}
                          className="text-red-600 hover:text-red-800 font-medium text-sm"
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------------------------
// Tier F commit 2 — inline modals for per-section ops.
// Kept local to this page so they don't escape into shared component
// land prematurely; refactor when a second page needs them.
// --------------------------------------------------------------------

function EditGridModal({ section, onCancel, onSave }) {
  const t = useTranslations('sectionOps')
  const [rows, setRows] = useState(section.gridRows)
  const [cols, setCols] = useState(section.gridColumns)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (saving) return
    setError('')
    setSaving(true)
    const errMsg = await onSave(section, parseInt(rows), parseInt(cols))
    setSaving(false)
    if (errMsg) setError(errMsg)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">
          {t('editTitle', { name: section.nameEn || section.nameRo })}
        </h3>
        {error && (
          <div className="mb-3 p-3 bg-red-50 border border-red-300 text-red-700 rounded text-sm">
            {error}
          </div>
        )}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('rowsLabel')}</label>
            <input
              type="number"
              min={1}
              max={30}
              value={rows}
              onChange={(e) => setRows(e.target.value)}
              disabled={saving}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('colsLabel')}</label>
            <input
              type="number"
              min={1}
              max={30}
              value={cols}
              onChange={(e) => setCols(e.target.value)}
              disabled={saving}
              className="w-full"
            />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            {t('cancelButton')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded bg-primary text-white font-medium hover:bg-primary-dark disabled:opacity-60"
          >
            {saving ? t('saving') : t('saveButton')}
          </button>
        </div>
      </div>
    </div>
  )
}

function DeleteSectionModal({ section, onCancel, onDelete }) {
  const t = useTranslations('sectionOps')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const handleConfirm = async () => {
    if (deleting) return
    setError('')
    setDeleting(true)
    const errMsg = await onDelete(section)
    setDeleting(false)
    if (errMsg) setError(errMsg)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">{t('deleteConfirmTitle')}</h3>
        <p className="text-sm text-gray-600 mb-4">
          <span className="font-medium">{section.nameEn || section.nameRo}</span> — {t('deleteConfirmBody')}
        </p>
        {error && (
          <div className="mb-3 p-3 bg-red-50 border border-red-300 text-red-700 rounded text-sm">
            {error}
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            {t('cancelButton')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={deleting}
            className="px-4 py-2 rounded bg-action-danger text-white font-medium hover:bg-action-danger-hover disabled:opacity-60"
          >
            {deleting ? t('deleting') : t('deleteButton')}
          </button>
        </div>
      </div>
    </div>
  )
}
