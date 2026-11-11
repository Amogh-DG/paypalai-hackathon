import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, RowClickedEvent } from "ag-grid-community";
import type { CustomCellRendererProps } from "ag-grid-react";
import type { AuditEntry } from "@leash/shared";

import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

import {
  formatLocalTime,
  formatAmount,
  getDecisionBadgeStyle,
  filterAuditEntries,
} from "../audit/helpers";
import { DetailPanel } from "../audit/DetailPanel";

export const AuditPage: React.FC = () => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [quickFilter, setQuickFilter] = useState<string>("");
  const [eventFilter, setEventFilter] = useState<string>("");
  const [proposalFilter, setProposalFilter] = useState<string>("");

  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);

  const entriesRef = useRef<AuditEntry[]>([]);
  entriesRef.current = entries;

  const latestReqIdRef = useRef<number>(0);
  const latestHandledReqIdRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gridRef = useRef<AgGridReact<AuditEntry>>(null);

  const fetchAudit = useCallback(async (isInitial = false) => {
    const reqId = ++latestReqIdRef.current;
    if (isInitial && entriesRef.current.length === 0) {
      setIsLoading(true);
      setInitialError(null);
    }
    try {
      const res = await fetch("/api/audit?limit=200");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = (await res.json()) as AuditEntry[];
      if (reqId < latestHandledReqIdRef.current) {
        return;
      }
      latestHandledReqIdRef.current = reqId;
      setEntries(data);
      setLastUpdated(new Date());
      setPollError(null);
      setInitialError(null);
    } catch (err: unknown) {
      if (reqId < latestHandledReqIdRef.current) {
        return;
      }
      latestHandledReqIdRef.current = reqId;
      const msg =
        err instanceof Error ? err.message : "Failed to load audit entries";
      if (entriesRef.current.length === 0) {
        setInitialError(msg);
      } else {
        setPollError(msg);
      }
    } finally {
      if (reqId >= latestHandledReqIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const startPolling = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      timerRef.current = setInterval(() => {
        if (!document.hidden) {
          fetchAudit(false);
        }
      }, 3000);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      } else {
        fetchAudit(false);
        startPolling();
      }
    };

    fetchAudit(true);
    startPolling();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchAudit]);

  const presentEvents = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      set.add(e.event);
    }
    return Array.from(set).sort();
  }, [entries]);

  const filteredEntries = useMemo(() => {
    return filterAuditEntries(entries, {
      quickFilter,
      eventFilter,
      proposalFilter,
    });
  }, [entries, quickFilter, eventFilter, proposalFilter]);

  const onProposalClick = useCallback((pid: string) => {
    setProposalFilter(pid);
  }, []);

  const columnDefs = useMemo<ColDef<AuditEntry>[]>(
    () => [
      {
        headerName: "Time",
        field: "timestamp",
        sort: "desc",
        sortable: true,
        resizable: true,
        valueFormatter: (params) =>
          params.value ? formatLocalTime(params.value) : "",
        comparator: (valueA: string, valueB: string) =>
          new Date(valueA).getTime() - new Date(valueB).getTime(),
        width: 190,
        minWidth: 170,
      },
      {
        headerName: "Event",
        field: "event",
        sortable: true,
        resizable: true,
        cellRenderer: (params: CustomCellRendererProps<AuditEntry>) => (
          <span
            style={{
              display: "inline-block",
              padding: "2px 8px",
              borderRadius: "4px",
              backgroundColor: "#f3f4f6",
              color: "#374151",
              fontSize: "12px",
              fontFamily: "monospace",
              border: "1px solid #e5e7eb",
              lineHeight: "1.4",
            }}
          >
            {params.value}
          </span>
        ),
        width: 170,
        minWidth: 150,
      },
      {
        headerName: "Proposal",
        field: "proposalId",
        sortable: true,
        resizable: true,
        cellRenderer: (params: CustomCellRendererProps<AuditEntry>) => {
          const pid = params.value as string | undefined;
          if (!pid) {
            return <span style={{ color: "#9ca3af" }}>-</span>;
          }
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onProposalClick(pid);
              }}
              style={{
                background: "none",
                border: "none",
                color: "#0070ba",
                textDecoration: "underline",
                cursor: "pointer",
                padding: 0,
                font: "inherit",
                fontFamily: "monospace",
                fontSize: "13px",
              }}
            >
              {pid}
            </button>
          );
        },
        width: 150,
        minWidth: 140,
      },
      {
        headerName: "Decision",
        field: "decision",
        sortable: true,
        resizable: true,
        cellRenderer: (params: CustomCellRendererProps<AuditEntry>) => {
          const decision = params.value as
            | "allow"
            | "ask"
            | "block"
            | undefined;
          if (!decision) {
            return null;
          }
          const style = getDecisionBadgeStyle(decision);
          if (!style) {
            return null;
          }
          return (
            <span
              style={{
                display: "inline-block",
                padding: "2px 8px",
                borderRadius: "4px",
                backgroundColor: style.bg,
                color: style.color,
                border: `1px solid ${style.border}`,
                fontWeight: 700,
                fontSize: "12px",
                lineHeight: "1.4",
                textTransform: "uppercase",
              }}
            >
              {decision}
            </span>
          );
        },
        width: 120,
        minWidth: 110,
      },
      {
        headerName: "Amount",
        field: "amount",
        sortable: true,
        resizable: true,
        valueFormatter: (params) => formatAmount(params.value),
        comparator: (valA?: number, valB?: number) =>
          (valA ?? 0) - (valB ?? 0),
        width: 120,
        minWidth: 110,
      },
      {
        headerName: "Summary",
        field: "summary",
        sortable: true,
        resizable: true,
        flex: 1,
        minWidth: 260,
      },
    ],
    [onProposalClick],
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: true,
      resizable: true,
    }),
    [],
  );

  const onRowClicked = useCallback((event: RowClickedEvent<AuditEntry>) => {
    if (event.data) {
      setSelectedEntry(event.data);
    }
  }, []);

  const handleClearFilters = useCallback(() => {
    setQuickFilter("");
    setEventFilter("");
    setProposalFilter("");
  }, []);

  const isFiltered = Boolean(quickFilter || eventFilter || proposalFilter);

  return (
    <div
      style={{
        maxWidth: "1400px",
        margin: "0 auto",
        padding: "1.5rem",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: "1rem",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "var(--color-text-primary)",
            }}
          >
            Audit Log
          </h2>
          <p
            style={{
              margin: "0.25rem 0 0 0",
              fontSize: "0.875rem",
              color: "var(--color-text-secondary)",
            }}
          >
            Real-time chronological audit trail of all governance and payment
            events
          </p>
        </div>

        {lastUpdated && (
          <div
            style={{
              fontSize: "0.8125rem",
              color: "var(--color-text-secondary)",
            }}
          >
            Last updated: {lastUpdated.toLocaleTimeString()}
          </div>
        )}
      </div>

      {pollError && (
        <div
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            backgroundColor: "#fffbeb",
            border: "1px solid #fcd34d",
            borderRadius: "6px",
            color: "#92400e",
            fontSize: "0.875rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>
            Notice: Failed to refresh audit log ({pollError}). Showing data from
            last update at{" "}
            {lastUpdated ? lastUpdated.toLocaleTimeString() : "earlier"}.
          </span>
          <button
            type="button"
            onClick={() => fetchAudit(false)}
            style={{
              padding: "0.25rem 0.5rem",
              backgroundColor: "#ffffff",
              border: "1px solid #d97706",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.75rem",
              color: "#92400e",
              fontWeight: 600,
            }}
          >
            Retry Now
          </button>
        </div>
      )}

      {isLoading && entries.length === 0 ? (
        <div
          style={{
            padding: "4rem 2rem",
            textAlign: "center",
            backgroundColor: "#ffffff",
            borderRadius: "8px",
            border: "1px solid #e5e7eb",
          }}
        >
          <div
            style={{
              fontSize: "1.125rem",
              fontWeight: 600,
              color: "#374151",
              marginBottom: "0.5rem",
            }}
          >
            Loading audit log...
          </div>
          <div style={{ color: "#6b7280", fontSize: "0.875rem" }}>
            Connecting to server and fetching recent entries.
          </div>
        </div>
      ) : initialError && entries.length === 0 ? (
        <div
          style={{
            padding: "3rem 2rem",
            textAlign: "center",
            backgroundColor: "#fef2f2",
            borderRadius: "8px",
            border: "1px solid #fca5a5",
          }}
        >
          <div
            style={{
              fontSize: "1.125rem",
              fontWeight: 600,
              color: "#991b1b",
              marginBottom: "0.5rem",
            }}
          >
            Unable to load audit entries
          </div>
          <div
            style={{
              color: "#b91c1c",
              fontSize: "0.875rem",
              marginBottom: "1rem",
            }}
          >
            {initialError}
          </div>
          <button
            type="button"
            onClick={() => fetchAudit(true)}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#b91c1c",
              color: "#ffffff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "0.875rem",
            }}
          >
            Retry
          </button>
        </div>
      ) : entries.length === 0 ? (
        <div
          style={{
            padding: "4rem 2rem",
            textAlign: "center",
            backgroundColor: "#ffffff",
            borderRadius: "8px",
            border: "1px solid #e5e7eb",
          }}
        >
          <div
            style={{
              fontSize: "1.125rem",
              fontWeight: 600,
              color: "#111827",
              marginBottom: "0.5rem",
            }}
          >
            No audit entries yet
          </div>
          <p
            style={{
              margin: 0,
              color: "#6b7280",
              fontSize: "0.875rem",
              maxWidth: "500px",
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            Audit events will appear here automatically when proposals are
            submitted, evaluated, approved, or processed for payment.
          </p>
        </div>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.75rem",
              alignItems: "center",
              padding: "1rem",
              backgroundColor: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: "8px 8px 0 0",
              borderBottom: "none",
            }}
          >
            <div style={{ flex: "2 1 200px" }}>
              <input
                type="text"
                placeholder="Quick filter across all columns..."
                value={quickFilter}
                onChange={(e) => setQuickFilter(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.875rem",
                  border: "1px solid #d1d5db",
                  borderRadius: "4px",
                  outline: "none",
                }}
              />
            </div>

            <div style={{ flex: "1 1 160px" }}>
              <select
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.875rem",
                  border: "1px solid #d1d5db",
                  borderRadius: "4px",
                  backgroundColor: "#ffffff",
                  outline: "none",
                }}
              >
                <option value="">All Events ({entries.length})</option>
                {presentEvents.map((evt) => (
                  <option key={evt} value={evt}>
                    {evt}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ flex: "1 1 180px" }}>
              <input
                type="text"
                placeholder="Filter by proposal id..."
                value={proposalFilter}
                onChange={(e) => setProposalFilter(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.875rem",
                  border: "1px solid #d1d5db",
                  borderRadius: "4px",
                  outline: "none",
                }}
              />
            </div>

            {isFiltered && (
              <button
                type="button"
                onClick={handleClearFilters}
                style={{
                  padding: "0.5rem 0.75rem",
                  backgroundColor: "#ffffff",
                  border: "1px solid #d1d5db",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  color: "#374151",
                }}
              >
                Clear Filters
              </button>
            )}

            <div
              style={{
                marginLeft: "auto",
                fontSize: "0.8125rem",
                color: "#6b7280",
                fontWeight: 500,
              }}
            >
              Showing {filteredEntries.length} of {entries.length} entries
            </div>
          </div>

          <div
            className="ag-theme-quartz"
            style={{
              width: "100%",
              height: "460px",
              border: "1px solid #e5e7eb",
              borderRadius: "0 0 8px 8px",
              overflow: "hidden",
            }}
          >
            <AgGridReact<AuditEntry>
              ref={gridRef}
              rowData={filteredEntries}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              rowSelection="single"
              onRowClicked={onRowClicked}
            />
          </div>

          {selectedEntry && (
            <DetailPanel
              entry={selectedEntry}
              onClose={() => {
                setSelectedEntry(null);
                gridRef.current?.api.deselectAll();
              }}
              onProposalClick={onProposalClick}
            />
          )}
        </>
      )}
    </div>
  );
};
