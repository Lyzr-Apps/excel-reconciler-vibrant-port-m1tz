'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { callAIAgent } from '@/lib/aiAgent'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem,
  SidebarMenuButton, SidebarProvider, SidebarTrigger
} from '@/components/ui/sidebar'
import {
  Upload, Settings, BarChart3, Clock, Loader2, FileText, CheckCircle,
  XCircle, AlertTriangle, ChevronDown, ChevronUp, Download, Mail, Send,
  ArrowRight, ArrowUp, ArrowDown, Trash2, Info, X,
  ChevronLeft, ChevronRight, AlertCircle, Check,
  Sparkles, Minus
} from 'lucide-react'

// ============ CONSTANTS ============

const RECONCILIATION_ANALYST_AGENT_ID = '699fe8c210134bfe58ea5f8d'
const REPORT_EXPORT_AGENT_ID = '699fe8c29bedc057f6133c9b'
const EMAIL_NOTIFICATION_AGENT_ID = '699fe8d1c9a21920fe89487e'

const THEME_VARS = {
  '--background': '0 0% 100%',
  '--foreground': '222 47% 11%',
  '--card': '0 0% 98%',
  '--card-foreground': '222 47% 11%',
  '--primary': '222 47% 11%',
  '--primary-foreground': '210 40% 98%',
  '--secondary': '210 40% 96%',
  '--secondary-foreground': '222 47% 11%',
  '--accent': '210 40% 92%',
  '--accent-foreground': '222 47% 11%',
  '--destructive': '0 84% 60%',
  '--muted': '210 40% 94%',
  '--muted-foreground': '215 16% 47%',
  '--border': '214 32% 91%',
  '--input': '214 32% 85%',
  '--ring': '222 47% 11%',
  '--radius': '0.875rem',
  '--chart-1': '12 76% 61%',
  '--chart-2': '173 58% 39%',
  '--chart-3': '197 37% 24%',
  '--chart-4': '43 74% 66%',
  '--chart-5': '27 87% 67%',
  '--sidebar-background': '210 40% 97%',
  '--sidebar-foreground': '222 47% 11%',
  '--sidebar-border': '214 32% 91%',
} as React.CSSProperties

const ROWS_PER_PAGE = 15

// ============ TYPES ============

interface FileMetadata {
  name: string
  rowCount: number
  columns: string[]
  numericColumns: string[]
  numericSums: Record<string, number>
}

interface RowData {
  [key: string]: string | number
}

interface ReconciliationResult {
  matches: RowData[]
  missingFromFile1: RowData[]
  missingFromFile2: RowData[]
  variances: { row1: RowData; row2: RowData; differences: Record<string, number> }[]
  summaryTotals: {
    matchCount: number
    matchAmount: number
    missingFile1Count: number
    missingFile1Amount: number
    missingFile2Count: number
    missingFile2Amount: number
    varianceCount: number
    varianceAmount: number
  }
}

interface AnalysisResult {
  summary: string
  match_rate: string
  key_findings: string
  anomalies: string
  missing_records_analysis: string
  variance_analysis: string
  recommendations: string
}

interface ExportResult {
  report_summary: string
  sections_included: string
  total_records_processed: string
  report_status: string
  fileUrl?: string
}

interface EmailResult {
  email_status: string
  recipient: string
  subject: string
  delivery_message: string
}

interface HistoryEntry {
  id: string
  date: string
  file1Name: string
  file2Name: string
  matchCount: number
  varianceCount: number
  missingCount: number
  status: string
}

type ScreenType = 'upload' | 'config' | 'results' | 'history'

// ============ HELPERS ============

function parseCSV(text: string): RowData[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '')
  if (lines.length < 2) return []

  const parseCSVLine = (line: string): string[] => {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    result.push(current.trim())
    return result
  }

  const headers = parseCSVLine(lines[0])
  const rows: RowData[] = []
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i])
    if (vals.length === 0 || (vals.length === 1 && vals[0] === '')) continue
    const row: RowData = {}
    headers.forEach((h, idx) => {
      const val = vals[idx] ?? ''
      const cleaned = val.replace(/[$,]/g, '')
      const num = parseFloat(cleaned)
      row[h] = !isNaN(num) && cleaned !== '' ? num : val
    })
    rows.push(row)
  }
  return rows
}

function detectNumericColumns(data: RowData[], columns: string[]): string[] {
  if (data.length === 0) return []
  return columns.filter(col => {
    let numericCount = 0
    const sample = data.slice(0, Math.min(10, data.length))
    sample.forEach(row => {
      if (typeof row[col] === 'number') numericCount++
    })
    return numericCount > sample.length * 0.5
  })
}

function computeSums(data: RowData[], numericCols: string[]): Record<string, number> {
  const sums: Record<string, number> = {}
  numericCols.forEach(col => {
    sums[col] = data.reduce((acc, row) => acc + (typeof row[col] === 'number' ? (row[col] as number) : 0), 0)
  })
  return sums
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val)
}

function formatNumber(val: number): string {
  return new Intl.NumberFormat('en-US').format(val)
}

function buildCompositeKey(row: RowData, keys: string[]): string {
  return keys.map(k => String(row[k] ?? '').toLowerCase().trim()).join('||')
}

function runReconciliation(
  file1Data: RowData[],
  file2Data: RowData[],
  matchKeys: string[],
  tolerance: number,
  toleranceType: 'absolute' | 'percentage',
  numericColumns: string[]
): ReconciliationResult {
  const file2Map = new Map<string, RowData>()
  const file2Matched = new Set<string>()

  file2Data.forEach(row => {
    const key = buildCompositeKey(row, matchKeys)
    file2Map.set(key, row)
  })

  const matches: RowData[] = []
  const missingFromFile2: RowData[] = []
  const variances: ReconciliationResult['variances'] = []

  const valueCols = numericColumns.filter(c => !matchKeys.includes(c))

  file1Data.forEach(row1 => {
    const key = buildCompositeKey(row1, matchKeys)
    const row2 = file2Map.get(key)

    if (!row2) {
      missingFromFile2.push(row1)
      return
    }

    file2Matched.add(key)

    const differences: Record<string, number> = {}
    let hasVariance = false

    valueCols.forEach(col => {
      const v1 = typeof row1[col] === 'number' ? (row1[col] as number) : 0
      const v2 = typeof row2[col] === 'number' ? (row2[col] as number) : 0
      const diff = v1 - v2

      if (Math.abs(diff) > 0.001) {
        let outsideTolerance = false
        if (toleranceType === 'absolute') {
          outsideTolerance = Math.abs(diff) > tolerance
        } else {
          const base = Math.max(Math.abs(v1), Math.abs(v2))
          if (base > 0) {
            outsideTolerance = (Math.abs(diff) / base) * 100 > tolerance
          }
        }

        if (outsideTolerance) {
          differences[col] = diff
          hasVariance = true
        }
      }
    })

    if (hasVariance) {
      variances.push({ row1, row2, differences })
    } else {
      matches.push(row1)
    }
  })

  const missingFromFile1: RowData[] = []
  file2Data.forEach(row2 => {
    const key = buildCompositeKey(row2, matchKeys)
    if (!file2Matched.has(key)) {
      missingFromFile1.push(row2)
    }
  })

  const sumFirstNumeric = (rows: RowData[]) => {
    if (valueCols.length === 0) return 0
    return rows.reduce((acc, r) => {
      const val = typeof r[valueCols[0]] === 'number' ? (r[valueCols[0]] as number) : 0
      return acc + val
    }, 0)
  }

  const varianceTotalAmount = variances.reduce((acc, v) => {
    return acc + Object.values(v.differences).reduce((s, d) => s + Math.abs(d), 0)
  }, 0)

  return {
    matches,
    missingFromFile1,
    missingFromFile2,
    variances,
    summaryTotals: {
      matchCount: matches.length,
      matchAmount: sumFirstNumeric(matches),
      missingFile1Count: missingFromFile1.length,
      missingFile1Amount: sumFirstNumeric(missingFromFile1),
      missingFile2Count: missingFromFile2.length,
      missingFile2Amount: sumFirstNumeric(missingFromFile2),
      varianceCount: variances.length,
      varianceAmount: varianceTotalAmount,
    }
  }
}

// ============ SAMPLE DATA ============

function generateSampleData(): {
  file1Data: RowData[]; file2Data: RowData[];
  file1Meta: FileMetadata; file2Meta: FileMetadata;
} {
  const file1Data: RowData[] = [
    { 'Invoice ID': 'INV-001', 'Customer': 'Acme Corp', 'Amount': 15000, 'Date': '2025-01-15', 'Category': 'Software' },
    { 'Invoice ID': 'INV-002', 'Customer': 'Globex Inc', 'Amount': 8500, 'Date': '2025-01-16', 'Category': 'Consulting' },
    { 'Invoice ID': 'INV-003', 'Customer': 'Initech', 'Amount': 22000, 'Date': '2025-01-17', 'Category': 'Hardware' },
    { 'Invoice ID': 'INV-004', 'Customer': 'Umbrella Ltd', 'Amount': 5200, 'Date': '2025-01-18', 'Category': 'Support' },
    { 'Invoice ID': 'INV-005', 'Customer': 'Wayne Enterprises', 'Amount': 31500, 'Date': '2025-01-19', 'Category': 'Software' },
    { 'Invoice ID': 'INV-006', 'Customer': 'Stark Industries', 'Amount': 12750, 'Date': '2025-01-20', 'Category': 'Consulting' },
    { 'Invoice ID': 'INV-007', 'Customer': 'Cyberdyne', 'Amount': 9800, 'Date': '2025-01-21', 'Category': 'Hardware' },
    { 'Invoice ID': 'INV-008', 'Customer': 'Massive Dynamic', 'Amount': 18400, 'Date': '2025-01-22', 'Category': 'Software' },
  ]

  const file2Data: RowData[] = [
    { 'Invoice ID': 'INV-001', 'Customer': 'Acme Corp', 'Amount': 15000, 'Date': '2025-01-15', 'Category': 'Software' },
    { 'Invoice ID': 'INV-002', 'Customer': 'Globex Inc', 'Amount': 8750, 'Date': '2025-01-16', 'Category': 'Consulting' },
    { 'Invoice ID': 'INV-003', 'Customer': 'Initech', 'Amount': 22000, 'Date': '2025-01-17', 'Category': 'Hardware' },
    { 'Invoice ID': 'INV-004', 'Customer': 'Umbrella Ltd', 'Amount': 5500, 'Date': '2025-01-18', 'Category': 'Support' },
    { 'Invoice ID': 'INV-005', 'Customer': 'Wayne Enterprises', 'Amount': 31500, 'Date': '2025-01-19', 'Category': 'Software' },
    { 'Invoice ID': 'INV-009', 'Customer': 'Oscorp', 'Amount': 7600, 'Date': '2025-01-23', 'Category': 'Support' },
    { 'Invoice ID': 'INV-010', 'Customer': 'LexCorp', 'Amount': 14200, 'Date': '2025-01-24', 'Category': 'Consulting' },
  ]

  const columns = ['Invoice ID', 'Customer', 'Amount', 'Date', 'Category']
  const numericColumns = ['Amount']

  return {
    file1Data,
    file2Data,
    file1Meta: {
      name: 'accounts_receivable_jan2025.csv',
      rowCount: file1Data.length,
      columns,
      numericColumns,
      numericSums: computeSums(file1Data, numericColumns),
    },
    file2Meta: {
      name: 'bank_statement_jan2025.csv',
      rowCount: file2Data.length,
      columns,
      numericColumns,
      numericSums: computeSums(file2Data, numericColumns),
    },
  }
}

// ============ MARKDOWN RENDERER ============

function formatInline(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.*?)\*\*/g)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="font-semibold">{part}</strong> : part
  )
}

function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null
  return (
    <div className="space-y-2">
      {text.split('\n').map((line, i) => {
        if (line.startsWith('### ')) return <h4 key={i} className="font-semibold text-sm mt-3 mb-1">{line.slice(4)}</h4>
        if (line.startsWith('## ')) return <h3 key={i} className="font-semibold text-base mt-3 mb-1">{line.slice(3)}</h3>
        if (line.startsWith('# ')) return <h2 key={i} className="font-bold text-lg mt-4 mb-2">{line.slice(2)}</h2>
        if (line.startsWith('- ') || line.startsWith('* ')) return <li key={i} className="ml-4 list-disc text-sm">{formatInline(line.slice(2))}</li>
        if (/^\d+\.\s/.test(line)) return <li key={i} className="ml-4 list-decimal text-sm">{formatInline(line.replace(/^\d+\.\s/, ''))}</li>
        if (!line.trim()) return <div key={i} className="h-1" />
        return <p key={i} className="text-sm">{formatInline(line)}</p>
      })}
    </div>
  )
}

// ============ ERROR BOUNDARY ============

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: '' }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
          <div className="text-center p-8 max-w-md">
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-muted-foreground mb-4 text-sm">{this.state.error}</p>
            <button onClick={() => this.setState({ hasError: false, error: '' })} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm">Try again</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ============ INLINE COMPONENTS ============

function StatCard({ title, value, subValue, icon, colorClass }: {
  title: string; value: string | number; subValue?: string;
  icon: React.ReactNode; colorClass: string;
}) {
  return (
    <Card className="bg-white/75 backdrop-blur-md shadow-md" style={{ border: '1px solid rgba(255,255,255,0.18)' }}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {subValue && <p className="text-xs text-muted-foreground">{subValue}</p>}
          </div>
          <div className={cn('p-2.5 rounded-xl', colorClass)}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function FileDropZone({ label, file, onFileDrop, parsing }: {
  label: string; file: File | null;
  onFileDrop: (f: File) => void; parsing: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) onFileDrop(f)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) onFileDrop(f)
  }

  return (
    <div
      className={cn(
        'border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-300 cursor-pointer',
        dragOver ? 'border-primary bg-primary/5 scale-[1.02]' : 'border-border hover:border-primary/40 hover:bg-muted/30',
        file ? 'border-green-400 bg-green-50/50' : ''
      )}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.tsv" className="hidden" onChange={handleChange} />
      {parsing ? (
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Parsing file...</p>
        </div>
      ) : file ? (
        <div className="flex flex-col items-center gap-3">
          <div className="p-3 rounded-xl bg-green-100">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <div>
            <p className="font-medium text-sm">{file.name}</p>
            <p className="text-xs text-muted-foreground mt-1">{(file.size / 1024).toFixed(1)} KB</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="p-3 rounded-xl bg-muted">
            <Upload className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium text-sm">{label}</p>
            <p className="text-xs text-muted-foreground mt-1">Drag and drop or click to browse</p>
            <p className="text-xs text-muted-foreground">.csv, .xlsx, .xls supported</p>
          </div>
        </div>
      )}
    </div>
  )
}

function PaginatedTable({ data, columns, pageSize, sortConfig, onSort, renderActions }: {
  data: RowData[]; columns: string[]; pageSize: number;
  sortConfig?: { key: string; dir: 'asc' | 'desc' };
  onSort?: (key: string) => void;
  renderActions?: (row: RowData, idx: number) => React.ReactNode;
}) {
  const [page, setPage] = useState(0)

  useEffect(() => { setPage(0) }, [data.length])

  const totalPages = Math.max(1, Math.ceil(data.length / pageSize))
  const start = page * pageSize
  const pageData = data.slice(start, start + pageSize)

  return (
    <div>
      <ScrollArea className="w-full">
        <div className="min-w-[600px]">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map(col => (
                  <TableHead key={col} className="cursor-pointer hover:bg-muted/50 whitespace-nowrap text-xs font-semibold" onClick={() => onSort?.(col)}>
                    <div className="flex items-center gap-1">
                      {col}
                      {sortConfig?.key === col && (sortConfig.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                    </div>
                  </TableHead>
                ))}
                {renderActions && <TableHead className="text-xs font-semibold">Approve</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length + (renderActions ? 1 : 0)} className="text-center text-muted-foreground py-8 text-sm">No data to display</TableCell>
                </TableRow>
              ) : (
                pageData.map((row, idx) => (
                  <TableRow key={start + idx} className="hover:bg-muted/30">
                    {columns.map(col => (
                      <TableCell key={col} className="text-xs whitespace-nowrap">
                        {typeof row[col] === 'number' ? formatNumber(row[col] as number) : String(row[col] ?? '')}
                      </TableCell>
                    ))}
                    {renderActions && <TableCell>{renderActions(row, start + idx)}</TableCell>}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2 py-3">
          <p className="text-xs text-muted-foreground">Showing {start + 1}-{Math.min(start + pageSize, data.length)} of {data.length}</p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} className="h-7 px-2">
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs px-2">{page + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} className="h-7 px-2">
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function VarianceTable({ variances, columns, pageSize }: {
  variances: ReconciliationResult['variances']; columns: string[]; pageSize: number;
}) {
  const [page, setPage] = useState(0)
  const totalPages = Math.max(1, Math.ceil(variances.length / pageSize))
  const start = page * pageSize
  const pageData = variances.slice(start, start + pageSize)

  useEffect(() => { setPage(0) }, [variances.length])

  return (
    <div>
      <ScrollArea className="w-full">
        <div className="min-w-[700px]">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map(col => (
                  <TableHead key={col} className="text-xs font-semibold whitespace-nowrap">{col}</TableHead>
                ))}
                <TableHead className="text-xs font-semibold whitespace-nowrap">Differences</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length + 1} className="text-center text-muted-foreground py-8 text-sm">No variances found</TableCell>
                </TableRow>
              ) : (
                pageData.map((v, idx) => (
                  <TableRow key={start + idx} className="hover:bg-amber-50/50">
                    {columns.map(col => (
                      <TableCell key={col} className="text-xs whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          <span>{typeof v.row1[col] === 'number' ? formatNumber(v.row1[col] as number) : String(v.row1[col] ?? '')}</span>
                          {v.differences[col] !== undefined && (
                            <span className="text-muted-foreground">vs {typeof v.row2[col] === 'number' ? formatNumber(v.row2[col] as number) : String(v.row2[col] ?? '')}</span>
                          )}
                        </div>
                      </TableCell>
                    ))}
                    <TableCell className="text-xs">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(v.differences).map(([col, diff]) => (
                          <Badge key={col} variant="outline" className={cn('text-xs', diff > 0 ? 'border-red-300 text-red-700 bg-red-50' : 'border-blue-300 text-blue-700 bg-blue-50')}>
                            {col}: {diff > 0 ? '+' : ''}{formatCurrency(diff)}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2 py-3">
          <p className="text-xs text-muted-foreground">Showing {start + 1}-{Math.min(start + pageSize, variances.length)} of {variances.length}</p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} className="h-7 px-2">
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs px-2">{page + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} className="h-7 px-2">
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============ MAIN PAGE ============

export default function Page() {
  // Navigation
  const [currentScreen, setCurrentScreen] = useState<ScreenType>('upload')

  // File upload state
  const [file1, setFile1] = useState<File | null>(null)
  const [file2, setFile2] = useState<File | null>(null)
  const [file1Data, setFile1Data] = useState<RowData[]>([])
  const [file2Data, setFile2Data] = useState<RowData[]>([])
  const [file1Meta, setFile1Meta] = useState<FileMetadata | null>(null)
  const [file2Meta, setFile2Meta] = useState<FileMetadata | null>(null)
  const [parsing1, setParsing1] = useState(false)
  const [parsing2, setParsing2] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)

  // Config state
  const [matchKeyType, setMatchKeyType] = useState<'single' | 'combination'>('single')
  const [selectedMatchKeys, setSelectedMatchKeys] = useState<string[]>([])
  const [toleranceValue, setToleranceValue] = useState<number>(0)
  const [toleranceType, setToleranceType] = useState<'absolute' | 'percentage'>('absolute')

  // Results state
  const [reconciliationResult, setReconciliationResult] = useState<ReconciliationResult | null>(null)
  const [isReconciling, setIsReconciling] = useState(false)
  const [activeResultTab, setActiveResultTab] = useState('matches')
  const [sortConfig, setSortConfig] = useState<{ key: string; dir: 'asc' | 'desc' } | undefined>()
  const [approvedMatches, setApprovedMatches] = useState<Set<number>>(new Set())

  // Agent states
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisOpen, setAnalysisOpen] = useState(false)

  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  const [exportLoading, setExportLoading] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const [emailForm, setEmailForm] = useState({ recipient: '', subject: '' })
  const [emailResult, setEmailResult] = useState<EmailResult | null>(null)
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)

  // History
  const [history, setHistory] = useState<HistoryEntry[]>([])

  // Sample data toggle
  const [sampleData, setSampleData] = useState(false)

  // Load history from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('reconciliation_history')
      if (stored) {
        setHistory(JSON.parse(stored))
      }
    } catch {
      // ignore
    }
  }, [])

  const saveHistory = useCallback((entry: HistoryEntry) => {
    setHistory(prev => {
      const updated = [entry, ...prev].slice(0, 50)
      try { localStorage.setItem('reconciliation_history', JSON.stringify(updated)) } catch { /* ignore */ }
      return updated
    })
  }, [])

  // File parsing
  const handleFileDrop = useCallback(async (file: File, which: 1 | 2) => {
    const setFileState = which === 1 ? setFile1 : setFile2
    const setData = which === 1 ? setFile1Data : setFile2Data
    const setMeta = which === 1 ? setFile1Meta : setFile2Meta
    const setParsing = which === 1 ? setParsing1 : setParsing2

    setParseError(null)
    setFileState(file)
    setParsing(true)

    try {
      const text = await file.text()
      let textForParsing = text
      if (file.name.endsWith('.tsv')) {
        textForParsing = text.split('\n').map(line => line.replace(/\t/g, ',')).join('\n')
      }

      const parsed = parseCSV(textForParsing)

      if (parsed.length === 0) {
        setParseError(`Could not parse ${file.name}. Please ensure it is a valid CSV file with headers.`)
        setParsing(false)
        return
      }

      const columns = Object.keys(parsed[0])
      const numericCols = detectNumericColumns(parsed, columns)
      const sums = computeSums(parsed, numericCols)

      setData(parsed)
      setMeta({
        name: file.name,
        rowCount: parsed.length,
        columns,
        numericColumns: numericCols,
        numericSums: sums,
      })
    } catch (err) {
      setParseError(`Error parsing ${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
    setParsing(false)
  }, [])

  // Sample data toggle handler
  useEffect(() => {
    if (sampleData) {
      const sample = generateSampleData()
      setFile1(new File([''], sample.file1Meta.name))
      setFile2(new File([''], sample.file2Meta.name))
      setFile1Data(sample.file1Data)
      setFile2Data(sample.file2Data)
      setFile1Meta(sample.file1Meta)
      setFile2Meta(sample.file2Meta)
      setSelectedMatchKeys(['Invoice ID'])
      setMatchKeyType('single')
      setToleranceValue(10)
      setToleranceType('absolute')
    } else {
      setFile1(null)
      setFile2(null)
      setFile1Data([])
      setFile2Data([])
      setFile1Meta(null)
      setFile2Meta(null)
      setSelectedMatchKeys([])
      setReconciliationResult(null)
      setAnalysisResult(null)
      setExportResult(null)
      setEmailResult(null)
    }
  }, [sampleData])

  // Run reconciliation
  const handleRunReconciliation = useCallback(() => {
    if (file1Data.length === 0 || file2Data.length === 0 || selectedMatchKeys.length === 0) return

    setIsReconciling(true)
    setAnalysisResult(null)
    setExportResult(null)
    setEmailResult(null)

    setTimeout(() => {
      const allNumericCols = [...new Set([
        ...(file1Meta?.numericColumns ?? []),
        ...(file2Meta?.numericColumns ?? []),
      ])]

      const result = runReconciliation(
        file1Data, file2Data, selectedMatchKeys,
        toleranceValue, toleranceType, allNumericCols
      )

      setReconciliationResult(result)
      setApprovedMatches(new Set())
      setIsReconciling(false)
      setCurrentScreen('results')

      saveHistory({
        id: Date.now().toString(),
        date: new Date().toISOString(),
        file1Name: file1Meta?.name ?? 'File 1',
        file2Name: file2Meta?.name ?? 'File 2',
        matchCount: result.summaryTotals.matchCount,
        varianceCount: result.summaryTotals.varianceCount,
        missingCount: result.summaryTotals.missingFile1Count + result.summaryTotals.missingFile2Count,
        status: 'Completed',
      })
    }, 300)
  }, [file1Data, file2Data, selectedMatchKeys, toleranceValue, toleranceType, file1Meta, file2Meta, saveHistory])

  // Agent: Analyze results
  const handleAnalyze = useCallback(async () => {
    if (!reconciliationResult) return
    setAnalysisLoading(true)
    setAnalysisError(null)
    setActiveAgentId(RECONCILIATION_ANALYST_AGENT_ID)

    const s = reconciliationResult.summaryTotals
    const message = `Analyze these reconciliation results between "${file1Meta?.name ?? 'File 1'}" and "${file2Meta?.name ?? 'File 2'}":

Summary:
- Total matches: ${s.matchCount} (total amount: ${formatCurrency(s.matchAmount)})
- Missing from File 1: ${s.missingFile1Count} records (amount: ${formatCurrency(s.missingFile1Amount)})
- Missing from File 2: ${s.missingFile2Count} records (amount: ${formatCurrency(s.missingFile2Amount)})
- Variances found: ${s.varianceCount} (total variance: ${formatCurrency(s.varianceAmount)})
- Match keys used: ${selectedMatchKeys.join(', ')}
- Tolerance: ${toleranceValue} ${toleranceType === 'absolute' ? 'USD' : '%'}
- File 1 rows: ${file1Data.length}, File 2 rows: ${file2Data.length}

Top variances: ${reconciliationResult.variances.slice(0, 5).map(v => {
  const diffs = Object.entries(v.differences).map(([k, d]) => `${k}: ${formatCurrency(d)}`).join(', ')
  return `${buildCompositeKey(v.row1, selectedMatchKeys)} => ${diffs}`
}).join('; ')}

Missing from File 2 (first 5): ${reconciliationResult.missingFromFile2.slice(0, 5).map(r => buildCompositeKey(r, selectedMatchKeys)).join(', ')}
Missing from File 1 (first 5): ${reconciliationResult.missingFromFile1.slice(0, 5).map(r => buildCompositeKey(r, selectedMatchKeys)).join(', ')}

Please provide a comprehensive analysis with summary, match_rate, key_findings, anomalies, missing_records_analysis, variance_analysis, and recommendations.`

    try {
      const result = await callAIAgent(message, RECONCILIATION_ANALYST_AGENT_ID)
      if (result.success) {
        const data = result?.response?.result
        setAnalysisResult({
          summary: data?.summary ?? '',
          match_rate: data?.match_rate ?? '',
          key_findings: data?.key_findings ?? '',
          anomalies: data?.anomalies ?? '',
          missing_records_analysis: data?.missing_records_analysis ?? '',
          variance_analysis: data?.variance_analysis ?? '',
          recommendations: data?.recommendations ?? '',
        })
        setAnalysisOpen(true)
      } else {
        setAnalysisError(result?.response?.message ?? 'Analysis failed. Please try again.')
      }
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Analysis failed.')
    }

    setAnalysisLoading(false)
    setActiveAgentId(null)
  }, [reconciliationResult, file1Meta, file2Meta, selectedMatchKeys, toleranceValue, toleranceType, file1Data.length, file2Data.length])

  // Agent: Export report
  const handleExport = useCallback(async () => {
    if (!reconciliationResult) return
    setExportLoading(true)
    setExportError(null)
    setActiveAgentId(REPORT_EXPORT_AGENT_ID)

    const s = reconciliationResult.summaryTotals
    const message = `Generate a structured Excel reconciliation report for the following data:

Files: "${file1Meta?.name ?? 'File 1'}" vs "${file2Meta?.name ?? 'File 2'}"
Match keys: ${selectedMatchKeys.join(', ')}
Tolerance: ${toleranceValue} ${toleranceType === 'absolute' ? 'USD' : '%'}

Summary:
- Matches: ${s.matchCount} records, total ${formatCurrency(s.matchAmount)}
- Missing from File 1: ${s.missingFile1Count} records, total ${formatCurrency(s.missingFile1Amount)}
- Missing from File 2: ${s.missingFile2Count} records, total ${formatCurrency(s.missingFile2Amount)}
- Variances: ${s.varianceCount} records, total variance ${formatCurrency(s.varianceAmount)}

Variance details:
${reconciliationResult.variances.slice(0, 20).map(v => {
  const key = buildCompositeKey(v.row1, selectedMatchKeys)
  const diffs = Object.entries(v.differences).map(([k, d]) => `${k}: File1=${v.row1[k]}, File2=${v.row2[k]}, Diff=${formatCurrency(d)}`).join('; ')
  return `${key}: ${diffs}`
}).join('\n')}

Missing from File 2: ${reconciliationResult.missingFromFile2.slice(0, 10).map(r => JSON.stringify(r)).join(', ')}
Missing from File 1: ${reconciliationResult.missingFromFile1.slice(0, 10).map(r => JSON.stringify(r)).join(', ')}

Please generate a downloadable report file with sections for matches, missing records, and variances.`

    try {
      const result = await callAIAgent(message, REPORT_EXPORT_AGENT_ID)
      if (result.success) {
        const data = result?.response?.result
        const files = Array.isArray(result?.module_outputs?.artifact_files) ? result.module_outputs.artifact_files : []
        const fileUrl = files?.[0]?.file_url ?? ''

        setExportResult({
          report_summary: data?.report_summary ?? '',
          sections_included: data?.sections_included ?? '',
          total_records_processed: data?.total_records_processed ?? '',
          report_status: data?.report_status ?? '',
          fileUrl,
        })

        if (fileUrl) {
          const link = document.createElement('a')
          link.href = fileUrl
          link.target = '_blank'
          link.rel = 'noopener noreferrer'
          link.click()
        }
      } else {
        setExportError(result?.response?.message ?? 'Export failed. Please try again.')
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed.')
    }

    setExportLoading(false)
    setActiveAgentId(null)
  }, [reconciliationResult, file1Meta, file2Meta, selectedMatchKeys, toleranceValue, toleranceType])

  // Agent: Send email
  const handleSendEmail = useCallback(async () => {
    if (!emailForm.recipient || !reconciliationResult) return
    setEmailLoading(true)
    setEmailError(null)
    setEmailResult(null)
    setActiveAgentId(EMAIL_NOTIFICATION_AGENT_ID)

    const s = reconciliationResult.summaryTotals
    const subjectLine = emailForm.subject || `Reconciliation Report: ${file1Meta?.name ?? 'File 1'} vs ${file2Meta?.name ?? 'File 2'}`

    const message = `Send an email to ${emailForm.recipient} with subject "${subjectLine}" containing the following reconciliation summary:

Excel Reconciliation Results
Files compared: "${file1Meta?.name ?? 'File 1'}" vs "${file2Meta?.name ?? 'File 2'}"

Summary:
- Matches: ${s.matchCount} records (${formatCurrency(s.matchAmount)})
- Missing from File 1: ${s.missingFile1Count} records (${formatCurrency(s.missingFile1Amount)})
- Missing from File 2: ${s.missingFile2Count} records (${formatCurrency(s.missingFile2Amount)})
- Variances: ${s.varianceCount} records (Total variance: ${formatCurrency(s.varianceAmount)})

Top variances:
${reconciliationResult.variances.slice(0, 5).map(v => {
  const key = buildCompositeKey(v.row1, selectedMatchKeys)
  const diffs = Object.entries(v.differences).map(([k, d]) => `${k}: ${formatCurrency(d)}`).join(', ')
  return `- ${key}: ${diffs}`
}).join('\n')}

Please review the reconciliation report for detailed findings.`

    try {
      const result = await callAIAgent(message, EMAIL_NOTIFICATION_AGENT_ID)
      if (result.success) {
        const data = result?.response?.result
        setEmailResult({
          email_status: data?.email_status ?? 'sent',
          recipient: data?.recipient ?? emailForm.recipient,
          subject: data?.subject ?? subjectLine,
          delivery_message: data?.delivery_message ?? 'Email sent successfully.',
        })
      } else {
        setEmailError(result?.response?.message ?? 'Email sending failed. Please try again.')
      }
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Email sending failed.')
    }

    setEmailLoading(false)
    setActiveAgentId(null)
  }, [emailForm, reconciliationResult, file1Meta, file2Meta, selectedMatchKeys])

  // Sorting helper
  const handleSort = useCallback((key: string) => {
    setSortConfig(prev => {
      if (prev?.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      }
      return { key, dir: 'asc' }
    })
  }, [])

  const sortData = useCallback((data: RowData[]) => {
    if (!sortConfig) return data
    return [...data].sort((a, b) => {
      const va = a[sortConfig.key]
      const vb = b[sortConfig.key]
      let cmp = 0
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb
      } else {
        cmp = String(va ?? '').localeCompare(String(vb ?? ''))
      }
      return sortConfig.dir === 'asc' ? cmp : -cmp
    })
  }, [sortConfig])

  // Toggle match key selection
  const toggleMatchKey = useCallback((key: string) => {
    if (matchKeyType === 'single') {
      setSelectedMatchKeys([key])
    } else {
      setSelectedMatchKeys(prev =>
        prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      )
    }
  }, [matchKeyType])

  // Derived values
  const commonColumns = file1Meta && file2Meta
    ? file1Meta.columns.filter(c => file2Meta.columns.includes(c))
    : []

  const allColumns = file1Meta?.columns ?? file2Meta?.columns ?? []

  const navItems: { screen: ScreenType; label: string; icon: React.ReactNode; disabled: boolean }[] = [
    { screen: 'upload', label: 'Upload', icon: <Upload className="h-4 w-4" />, disabled: false },
    { screen: 'config', label: 'Configuration', icon: <Settings className="h-4 w-4" />, disabled: !file1Meta || !file2Meta },
    { screen: 'results', label: 'Results', icon: <BarChart3 className="h-4 w-4" />, disabled: !reconciliationResult },
    { screen: 'history', label: 'History', icon: <Clock className="h-4 w-4" />, disabled: false },
  ]

  // ============ RENDER SCREENS ============

  function renderUploadScreen() {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight" style={{ letterSpacing: '-0.01em' }}>Upload Files</h2>
          <p className="text-sm text-muted-foreground" style={{ lineHeight: '1.55' }}>Upload two Excel or CSV files to compare and reconcile. Both files should share common columns for matching.</p>
        </div>

        {parseError && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{parseError}</span>
            <Button variant="ghost" size="sm" className="ml-auto h-6 px-2" onClick={() => setParseError(null)}><X className="h-3 w-3" /></Button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="bg-white/75 backdrop-blur-md shadow-md" style={{ border: '1px solid rgba(255,255,255,0.18)' }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-600" />
                Source File (File 1)
              </CardTitle>
              <CardDescription className="text-xs">e.g. Accounts Receivable, General Ledger</CardDescription>
            </CardHeader>
            <CardContent>
              <FileDropZone label="Upload Source File" file={file1} onFileDrop={(f) => handleFileDrop(f, 1)} parsing={parsing1} />
              {file1Meta && (
                <div className="mt-4 p-3 rounded-xl bg-muted/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Rows</span>
                    <Badge variant="secondary" className="text-xs">{formatNumber(file1Meta.rowCount)}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Columns</span>
                    <Badge variant="secondary" className="text-xs">{file1Meta.columns.length}</Badge>
                  </div>
                  <Separator />
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Column Headers</span>
                    <div className="flex flex-wrap gap-1">
                      {file1Meta.columns.map(c => <Badge key={c} variant="outline" className="text-xs">{c}</Badge>)}
                    </div>
                  </div>
                  {file1Meta.numericColumns.length > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">Numeric Totals</span>
                        {file1Meta.numericColumns.map(col => (
                          <div key={col} className="flex items-center justify-between">
                            <span className="text-xs">{col}</span>
                            <span className="text-xs font-medium">{formatCurrency(file1Meta.numericSums[col] ?? 0)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white/75 backdrop-blur-md shadow-md" style={{ border: '1px solid rgba(255,255,255,0.18)' }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-green-600" />
                Comparison File (File 2)
              </CardTitle>
              <CardDescription className="text-xs">e.g. Bank Statement, External Report</CardDescription>
            </CardHeader>
            <CardContent>
              <FileDropZone label="Upload Comparison File" file={file2} onFileDrop={(f) => handleFileDrop(f, 2)} parsing={parsing2} />
              {file2Meta && (
                <div className="mt-4 p-3 rounded-xl bg-muted/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Rows</span>
                    <Badge variant="secondary" className="text-xs">{formatNumber(file2Meta.rowCount)}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Columns</span>
                    <Badge variant="secondary" className="text-xs">{file2Meta.columns.length}</Badge>
                  </div>
                  <Separator />
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Column Headers</span>
                    <div className="flex flex-wrap gap-1">
                      {file2Meta.columns.map(c => <Badge key={c} variant="outline" className="text-xs">{c}</Badge>)}
                    </div>
                  </div>
                  {file2Meta.numericColumns.length > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">Numeric Totals</span>
                        {file2Meta.numericColumns.map(col => (
                          <div key={col} className="flex items-center justify-between">
                            <span className="text-xs">{col}</span>
                            <span className="text-xs font-medium">{formatCurrency(file2Meta.numericSums[col] ?? 0)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end">
          <Button
            size="lg"
            disabled={!file1Meta || !file2Meta}
            onClick={() => setCurrentScreen('config')}
            className="gap-2"
          >
            Continue to Configuration
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  function renderConfigScreen() {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight" style={{ letterSpacing: '-0.01em' }}>Configuration</h2>
          <p className="text-sm text-muted-foreground" style={{ lineHeight: '1.55' }}>Set up matching criteria and tolerance thresholds for the reconciliation.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-white/75 backdrop-blur-md shadow-md" style={{ border: '1px solid rgba(255,255,255,0.18)' }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Match Key Configuration</CardTitle>
              <CardDescription className="text-xs">Select the field(s) used to match records between files</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Match Key Type</Label>
                <RadioGroup
                  value={matchKeyType}
                  onValueChange={(v) => {
                    setMatchKeyType(v as 'single' | 'combination')
                    setSelectedMatchKeys([])
                  }}
                  className="flex gap-4"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="single" id="single" />
                    <Label htmlFor="single" className="text-sm cursor-pointer">Single Field</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="combination" id="combination" />
                    <Label htmlFor="combination" className="text-sm cursor-pointer">Combination of Fields</Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  {matchKeyType === 'single' ? 'Select Match Field' : 'Select Match Fields'}
                </Label>
                {commonColumns.length === 0 ? (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    <span>No common columns found between the two files. Please upload files with shared column headers.</span>
                  </div>
                ) : (
                  matchKeyType === 'single' ? (
                    <Select value={selectedMatchKeys[0] ?? ''} onValueChange={(v) => setSelectedMatchKeys([v])}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a column" />
                      </SelectTrigger>
                      <SelectContent>
                        {commonColumns.map(col => (
                          <SelectItem key={col} value={col}>{col}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {commonColumns.map(col => (
                        <Badge
                          key={col}
                          variant={selectedMatchKeys.includes(col) ? 'default' : 'outline'}
                          className="cursor-pointer text-xs transition-all hover:shadow-sm"
                          onClick={() => toggleMatchKey(col)}
                        >
                          {selectedMatchKeys.includes(col) && <Check className="h-3 w-3 mr-1" />}
                          {col}
                        </Badge>
                      ))}
                    </div>
                  )
                )}
                {selectedMatchKeys.length > 0 && (
                  <p className="text-xs text-muted-foreground">Selected: {selectedMatchKeys.join(' + ')}</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/75 backdrop-blur-md shadow-md" style={{ border: '1px solid rgba(255,255,255,0.18)' }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Tolerance Threshold</CardTitle>
              <CardDescription className="text-xs">Define acceptable variance between matching records</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Tolerance Type</Label>
                <RadioGroup
                  value={toleranceType}
                  onValueChange={(v) => setToleranceType(v as 'absolute' | 'percentage')}
                  className="flex gap-4"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="absolute" id="abs" />
                    <Label htmlFor="abs" className="text-sm cursor-pointer">Absolute ($)</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="percentage" id="pct" />
                    <Label htmlFor="pct" className="text-sm cursor-pointer">Percentage (%)</Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Threshold Value</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    step={toleranceType === 'percentage' ? 0.1 : 1}
                    value={toleranceValue}
                    onChange={(e) => setToleranceValue(parseFloat(e.target.value) || 0)}
                    className="max-w-[180px]"
                  />
                  <span className="text-sm text-muted-foreground font-medium">
                    {toleranceType === 'absolute' ? 'USD' : '%'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Differences within {toleranceValue} {toleranceType === 'absolute' ? 'USD' : '%'} will be treated as matches.
                </p>
              </div>

              <Separator />

              <div className="p-3 rounded-xl bg-blue-50/80 border border-blue-100 space-y-1">
                <div className="flex items-center gap-2 text-blue-800 text-xs font-medium">
                  <Info className="h-3.5 w-3.5" />
                  Configuration Summary
                </div>
                <p className="text-xs text-blue-700">
                  Matching on: <strong>{selectedMatchKeys.length > 0 ? selectedMatchKeys.join(' + ') : 'Not selected'}</strong>
                </p>
                <p className="text-xs text-blue-700">
                  Tolerance: <strong>{toleranceValue} {toleranceType === 'absolute' ? 'USD' : '%'}</strong>
                </p>
                <p className="text-xs text-blue-700">
                  File 1: <strong>{file1Meta?.rowCount ?? 0} rows</strong> | File 2: <strong>{file2Meta?.rowCount ?? 0} rows</strong>
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {selectedMatchKeys.length > 0 && (
          <Card className="bg-white/75 backdrop-blur-md shadow-md" style={{ border: '1px solid rgba(255,255,255,0.18)' }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Column Preview</CardTitle>
              <CardDescription className="text-xs">Sample data from both files for selected match key(s)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">File 1: {file1Meta?.name}</p>
                  <ScrollArea className="max-h-[200px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {selectedMatchKeys.map(k => <TableHead key={k} className="text-xs">{k}</TableHead>)}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {file1Data.slice(0, 5).map((row, i) => (
                          <TableRow key={i}>
                            {selectedMatchKeys.map(k => <TableCell key={k} className="text-xs">{String(row[k] ?? '')}</TableCell>)}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">File 2: {file2Meta?.name}</p>
                  <ScrollArea className="max-h-[200px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {selectedMatchKeys.map(k => <TableHead key={k} className="text-xs">{k}</TableHead>)}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {file2Data.slice(0, 5).map((row, i) => (
                          <TableRow key={i}>
                            {selectedMatchKeys.map(k => <TableCell key={k} className="text-xs">{String(row[k] ?? '')}</TableCell>)}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={() => setCurrentScreen('upload')} className="gap-2">
            <ChevronLeft className="h-4 w-4" /> Back to Upload
          </Button>
          <Button
            size="lg"
            disabled={selectedMatchKeys.length === 0 || isReconciling}
            onClick={handleRunReconciliation}
            className="gap-2"
          >
            {isReconciling ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Run Reconciliation
              </>
            )}
          </Button>
        </div>
      </div>
    )
  }

  function renderResultsScreen() {
    if (!reconciliationResult) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <BarChart3 className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold mb-1">No Results Yet</h3>
          <p className="text-sm text-muted-foreground mb-4">Upload files and run reconciliation to see results here.</p>
          <Button onClick={() => setCurrentScreen('upload')}>Go to Upload</Button>
        </div>
      )
    }

    const s = reconciliationResult.summaryTotals
    const displayColumns = allColumns

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight" style={{ letterSpacing: '-0.01em' }}>Reconciliation Results</h2>
            <p className="text-sm text-muted-foreground">
              {file1Meta?.name ?? 'File 1'} vs {file2Meta?.name ?? 'File 2'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={handleAnalyze} disabled={analysisLoading} className="gap-2 text-sm">
              {analysisLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Analyze
            </Button>
            <Button variant="outline" onClick={handleExport} disabled={exportLoading} className="gap-2 text-sm">
              {exportLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export
            </Button>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Matches"
            value={formatNumber(s.matchCount)}
            subValue={formatCurrency(s.matchAmount)}
            icon={<CheckCircle className="h-5 w-5 text-green-600" />}
            colorClass="bg-green-100"
          />
          <StatCard
            title="Missing from File 1"
            value={formatNumber(s.missingFile1Count)}
            subValue={formatCurrency(s.missingFile1Amount)}
            icon={<XCircle className="h-5 w-5 text-red-600" />}
            colorClass="bg-red-100"
          />
          <StatCard
            title="Missing from File 2"
            value={formatNumber(s.missingFile2Count)}
            subValue={formatCurrency(s.missingFile2Amount)}
            icon={<XCircle className="h-5 w-5 text-red-600" />}
            colorClass="bg-red-100"
          />
          <StatCard
            title="Variances"
            value={formatNumber(s.varianceCount)}
            subValue={formatCurrency(s.varianceAmount)}
            icon={<AlertTriangle className="h-5 w-5 text-amber-600" />}
            colorClass="bg-amber-100"
          />
        </div>

        {/* Analysis Error */}
        {analysisError && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{analysisError}</span>
            <Button variant="ghost" size="sm" className="ml-auto h-6 px-2" onClick={() => setAnalysisError(null)}><X className="h-3 w-3" /></Button>
          </div>
        )}

        {/* Analysis Insight Panel */}
        {analysisResult && (
          <Collapsible open={analysisOpen} onOpenChange={setAnalysisOpen}>
            <Card className="bg-white/75 backdrop-blur-md shadow-md border-l-4 border-l-blue-500" style={{ border: '1px solid rgba(255,255,255,0.18)', borderLeft: '4px solid hsl(222 47% 11%)' }}>
              <CollapsibleTrigger asChild>
                <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-blue-600" />
                      AI Analysis Insights
                    </CardTitle>
                    {analysisOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                  {analysisResult.match_rate && (
                    <div className="mt-2">
                      <Badge variant="secondary" className="text-xs">Match Rate: {analysisResult.match_rate}</Badge>
                    </div>
                  )}
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <Tabs defaultValue="summary" className="w-full">
                    <TabsList className="flex flex-wrap h-auto p-1 gap-1">
                      <TabsTrigger value="summary" className="text-xs px-2 py-1.5">Summary</TabsTrigger>
                      <TabsTrigger value="findings" className="text-xs px-2 py-1.5">Key Findings</TabsTrigger>
                      <TabsTrigger value="anomalies" className="text-xs px-2 py-1.5">Anomalies</TabsTrigger>
                      <TabsTrigger value="missing" className="text-xs px-2 py-1.5">Missing Records</TabsTrigger>
                      <TabsTrigger value="variance" className="text-xs px-2 py-1.5">Variance Analysis</TabsTrigger>
                      <TabsTrigger value="recs" className="text-xs px-2 py-1.5">Recommendations</TabsTrigger>
                    </TabsList>
                    <div className="mt-4">
                      <TabsContent value="summary">{renderMarkdown(analysisResult.summary)}</TabsContent>
                      <TabsContent value="findings">{renderMarkdown(analysisResult.key_findings)}</TabsContent>
                      <TabsContent value="anomalies">{renderMarkdown(analysisResult.anomalies)}</TabsContent>
                      <TabsContent value="missing">{renderMarkdown(analysisResult.missing_records_analysis)}</TabsContent>
                      <TabsContent value="variance">{renderMarkdown(analysisResult.variance_analysis)}</TabsContent>
                      <TabsContent value="recs">{renderMarkdown(analysisResult.recommendations)}</TabsContent>
                    </div>
                  </Tabs>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        )}

        {/* Export Status */}
        {exportError && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{exportError}</span>
            <Button variant="ghost" size="sm" className="ml-auto h-6 px-2" onClick={() => setExportError(null)}><X className="h-3 w-3" /></Button>
          </div>
        )}

        {exportResult && (
          <Card className="bg-white/75 backdrop-blur-md shadow-md" style={{ border: '1px solid rgba(255,255,255,0.18)', borderLeft: '4px solid hsl(173 58% 39%)' }}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-100">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Report Generated Successfully</p>
                    <p className="text-xs text-muted-foreground">{exportResult.report_summary}</p>
                    {exportResult.sections_included && (
                      <p className="text-xs text-muted-foreground mt-0.5">Sections: {exportResult.sections_included}</p>
                    )}
                    {exportResult.total_records_processed && (
                      <p className="text-xs text-muted-foreground mt-0.5">Records processed: {exportResult.total_records_processed}</p>
                    )}
                    {exportResult.report_status && (
                      <p className="text-xs text-muted-foreground mt-0.5">Status: {exportResult.report_status}</p>
                    )}
                  </div>
                </div>
                {exportResult.fileUrl && (
                  <Button size="sm" variant="outline" className="gap-2" onClick={() => { const link = document.createElement('a'); link.href = exportResult.fileUrl ?? ''; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.click() }}>
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Data Tables */}
        <Card className="bg-white/75 backdrop-blur-md shadow-md" style={{ border: '1px solid rgba(255,255,255,0.18)' }}>
          <CardContent className="p-0">
            <Tabs value={activeResultTab} onValueChange={setActiveResultTab}>
              <div className="px-4 pt-4">
                <TabsList className="grid grid-cols-4 gap-1">
                  <TabsTrigger value="matches" className="text-xs gap-1.5">
                    <CheckCircle className="h-3 w-3" />
                    Matches ({s.matchCount})
                  </TabsTrigger>
                  <TabsTrigger value="missingFile1" className="text-xs gap-1.5">
                    <Minus className="h-3 w-3" />
                    Missing F1 ({s.missingFile1Count})
                  </TabsTrigger>
                  <TabsTrigger value="missingFile2" className="text-xs gap-1.5">
                    <Minus className="h-3 w-3" />
                    Missing F2 ({s.missingFile2Count})
                  </TabsTrigger>
                  <TabsTrigger value="variances" className="text-xs gap-1.5">
                    <AlertTriangle className="h-3 w-3" />
                    Variances ({s.varianceCount})
                  </TabsTrigger>
                </TabsList>
              </div>

              <div className="p-4 pt-2">
                <TabsContent value="matches" className="mt-2">
                  <PaginatedTable
                    data={sortData(reconciliationResult.matches)}
                    columns={displayColumns}
                    pageSize={ROWS_PER_PAGE}
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    renderActions={(_row, idx) => (
                      <Checkbox
                        checked={approvedMatches.has(idx)}
                        onCheckedChange={(checked) => {
                          setApprovedMatches(prev => {
                            const next = new Set(prev)
                            if (checked) next.add(idx)
                            else next.delete(idx)
                            return next
                          })
                        }}
                      />
                    )}
                  />
                  {approvedMatches.size > 0 && (
                    <p className="text-xs text-muted-foreground mt-2">{approvedMatches.size} match(es) approved</p>
                  )}
                </TabsContent>

                <TabsContent value="missingFile1" className="mt-2">
                  <PaginatedTable
                    data={sortData(reconciliationResult.missingFromFile1)}
                    columns={displayColumns}
                    pageSize={ROWS_PER_PAGE}
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                </TabsContent>

                <TabsContent value="missingFile2" className="mt-2">
                  <PaginatedTable
                    data={sortData(reconciliationResult.missingFromFile2)}
                    columns={displayColumns}
                    pageSize={ROWS_PER_PAGE}
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                </TabsContent>

                <TabsContent value="variances" className="mt-2">
                  <VarianceTable
                    variances={reconciliationResult.variances}
                    columns={displayColumns}
                    pageSize={ROWS_PER_PAGE}
                  />
                </TabsContent>
              </div>
            </Tabs>
          </CardContent>
        </Card>

        {/* Email Notification Panel */}
        <Collapsible open={emailOpen} onOpenChange={setEmailOpen}>
          <Card className="bg-white/75 backdrop-blur-md shadow-md" style={{ border: '1px solid rgba(255,255,255,0.18)' }}>
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    Email Notification
                  </CardTitle>
                  {emailOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
                <CardDescription className="text-xs">Send reconciliation results summary via email</CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email-recipient" className="text-sm font-medium">Recipient Email *</Label>
                  <Input
                    id="email-recipient"
                    type="email"
                    placeholder="recipient@example.com"
                    value={emailForm.recipient}
                    onChange={(e) => setEmailForm(prev => ({ ...prev, recipient: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email-subject" className="text-sm font-medium">Subject (optional)</Label>
                  <Input
                    id="email-subject"
                    type="text"
                    placeholder="Reconciliation Report Summary"
                    value={emailForm.subject}
                    onChange={(e) => setEmailForm(prev => ({ ...prev, subject: e.target.value }))}
                  />
                </div>

                {emailError && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    <span>{emailError}</span>
                    <Button variant="ghost" size="sm" className="ml-auto h-6 px-2" onClick={() => setEmailError(null)}><X className="h-3 w-3" /></Button>
                  </div>
                )}

                {emailResult && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm">
                    <CheckCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">Email Sent</p>
                      <p className="text-xs mt-0.5">Status: {emailResult.email_status}</p>
                      <p className="text-xs">To: {emailResult.recipient}</p>
                      <p className="text-xs">Subject: {emailResult.subject}</p>
                      {emailResult.delivery_message && <p className="text-xs mt-0.5">{emailResult.delivery_message}</p>}
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleSendEmail}
                  disabled={!emailForm.recipient || emailLoading}
                  className="gap-2"
                >
                  {emailLoading ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Sending...</>
                  ) : (
                    <><Send className="h-4 w-4" /> Send Notification</>
                  )}
                </Button>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </div>
    )
  }

  function renderHistoryScreen() {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight" style={{ letterSpacing: '-0.01em' }}>Reconciliation History</h2>
            <p className="text-sm text-muted-foreground" style={{ lineHeight: '1.55' }}>View past reconciliation runs stored locally in your browser.</p>
          </div>
          {history.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 text-destructive hover:text-destructive"
              onClick={() => {
                setHistory([])
                try { localStorage.removeItem('reconciliation_history') } catch { /* ignore */ }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear History
            </Button>
          )}
        </div>

        {history.length === 0 ? (
          <Card className="bg-white/75 backdrop-blur-md shadow-md" style={{ border: '1px solid rgba(255,255,255,0.18)' }}>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Clock className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold mb-1">No History Yet</h3>
              <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
                Complete a reconciliation run and it will appear here. History is stored locally in your browser.
              </p>
              <Button variant="outline" onClick={() => setCurrentScreen('upload')}>Start a Reconciliation</Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-white/75 backdrop-blur-md shadow-md" style={{ border: '1px solid rgba(255,255,255,0.18)' }}>
            <CardContent className="p-0">
              <ScrollArea className="w-full">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs font-semibold">Date</TableHead>
                      <TableHead className="text-xs font-semibold">File 1</TableHead>
                      <TableHead className="text-xs font-semibold">File 2</TableHead>
                      <TableHead className="text-xs font-semibold text-center">Matches</TableHead>
                      <TableHead className="text-xs font-semibold text-center">Variances</TableHead>
                      <TableHead className="text-xs font-semibold text-center">Missing</TableHead>
                      <TableHead className="text-xs font-semibold">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((entry) => (
                      <TableRow key={entry.id} className="hover:bg-muted/30">
                        <TableCell className="text-xs whitespace-nowrap">
                          {new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </TableCell>
                        <TableCell className="text-xs max-w-[150px] truncate">{entry.file1Name}</TableCell>
                        <TableCell className="text-xs max-w-[150px] truncate">{entry.file2Name}</TableCell>
                        <TableCell className="text-xs text-center">
                          <Badge variant="secondary" className="text-xs bg-green-100 text-green-800">{entry.matchCount}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-center">
                          <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-800">{entry.varianceCount}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-center">
                          <Badge variant="secondary" className="text-xs bg-red-100 text-red-800">{entry.missingCount}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{entry.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  // ============ MAIN RENDER ============

  return (
    <ErrorBoundary>
      <div style={THEME_VARS} className="min-h-screen bg-background text-foreground font-sans">
        <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, hsl(210 20% 97%) 0%, hsl(220 25% 95%) 35%, hsl(200 20% 96%) 70%, hsl(230 15% 97%) 100%)' }}>
          <SidebarProvider>
            <div className="flex min-h-screen w-full">
              {/* Sidebar */}
              <Sidebar className="border-r" style={{ '--sidebar-background': '210 40% 97%', '--sidebar-border': '214 32% 91%' } as React.CSSProperties}>
                <SidebarHeader className="p-4 border-b">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-primary">
                      <FileText className="h-5 w-5 text-primary-foreground" />
                    </div>
                    <div>
                      <h1 className="text-sm font-bold tracking-tight leading-none">Reconciliation</h1>
                      <p className="text-xs text-muted-foreground mt-0.5">Hub</p>
                    </div>
                  </div>
                </SidebarHeader>
                <SidebarContent className="p-2">
                  <SidebarMenu>
                    {navItems.map(item => (
                      <SidebarMenuItem key={item.screen}>
                        <SidebarMenuButton
                          isActive={currentScreen === item.screen}
                          onClick={() => !item.disabled && setCurrentScreen(item.screen)}
                          className={cn(
                            'w-full justify-start gap-3 rounded-xl transition-all',
                            item.disabled && 'opacity-40 cursor-not-allowed'
                          )}
                        >
                          {item.icon}
                          <span className="text-sm font-medium">{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarContent>

                {/* Agent Status Footer */}
                <div className="mt-auto p-3 border-t">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Agents</p>
                  <div className="space-y-1.5">
                    {[
                      { id: RECONCILIATION_ANALYST_AGENT_ID, name: 'Analyst', purpose: 'Insights' },
                      { id: REPORT_EXPORT_AGENT_ID, name: 'Export', purpose: 'Reports' },
                      { id: EMAIL_NOTIFICATION_AGENT_ID, name: 'Email', purpose: 'Notify' },
                    ].map(agent => (
                      <div key={agent.id} className="flex items-center gap-2">
                        <div className={cn('h-1.5 w-1.5 rounded-full', activeAgentId === agent.id ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/30')} />
                        <span className="text-xs">{agent.name}</span>
                        <span className="text-xs text-muted-foreground ml-auto">{agent.purpose}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Sidebar>

              {/* Main Content */}
              <div className="flex-1 flex flex-col min-w-0">
                {/* Top Bar */}
                <header className="h-14 border-b bg-white/60 backdrop-blur-md flex items-center justify-between px-4 flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <SidebarTrigger />
                    <Separator orientation="vertical" className="h-6" />
                    <nav className="flex items-center gap-1 text-sm">
                      {navItems.map((item, i) => (
                        <React.Fragment key={item.screen}>
                          {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                          <span
                            className={cn(
                              'text-xs cursor-pointer transition-colors',
                              currentScreen === item.screen ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'
                            )}
                            onClick={() => !item.disabled && setCurrentScreen(item.screen)}
                          >
                            {item.label}
                          </span>
                        </React.Fragment>
                      ))}
                    </nav>
                  </div>
                  <div className="flex items-center gap-3">
                    <Label htmlFor="sample-toggle" className="text-xs text-muted-foreground cursor-pointer">Sample Data</Label>
                    <Switch id="sample-toggle" checked={sampleData} onCheckedChange={setSampleData} />
                  </div>
                </header>

                {/* Content Area */}
                <ScrollArea className="flex-1">
                  <main className="p-6">
                    {currentScreen === 'upload' && renderUploadScreen()}
                    {currentScreen === 'config' && renderConfigScreen()}
                    {currentScreen === 'results' && renderResultsScreen()}
                    {currentScreen === 'history' && renderHistoryScreen()}
                  </main>
                </ScrollArea>
              </div>
            </div>
          </SidebarProvider>
        </div>
      </div>
    </ErrorBoundary>
  )
}
