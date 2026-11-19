# Diagrams

These are Mermaid diagrams, which GitHub and most editors render. They match the designs approved during discussion.

## System architecture

```mermaid
flowchart TB
  subgraph Clients
    WEB["Web app (Next.js)<br/>role dashboards, WCAG 2.2 AA"]
    FIELD["Field client (PWA)<br/>offline-first"]
    SIM["Reader simulator<br/>(vendor adapter later)"]
    SMSU["Retailer phone<br/>SMS code / reply"]
  end

  subgraph API["API (NestJS modular monolith)"]
    AUTH["Sign-in + MFA"] --> PERM["Per-task permissions<br/>tenant + location scope"]
    subgraph Ops["Operations"]
      ITEMS[Tracked items / cylinders]
      FILL[Filling & QC]
      SCAN[Scan sessions]
      CUST[Custody & handovers]
      DIST[Distribution]
      INV[Inventory]
    end
    subgraph Money
      SALES[Sales & invoicing]
      LEDGER[Ledger & credit]
    end
    INVEST["Investigations<br/>(restricted)"]
    NOTIF[Notifications]
    REP[Reporting]
  end

  subgraph Data
    PG[("PostgreSQL + PostGIS<br/>row-level security")]
    EV[("business_events<br/>append-only + outbox")]
    RD[(Redis / BullMQ)]
    OBJ[("Object storage<br/>hashed evidence")]
  end

  subgraph Adapters["Adapters (later / verified)"]
    RFID[RFID vendor]
    GPS[GPS]
    PAY[M-Pesa & bank]
    KRA[KRA eTIMS]
    SMS[SMS provider]
  end

  WEB --> AUTH
  FIELD --> AUTH
  SIM --> AUTH
  SMSU <--> SMS
  PERM --> Ops & Money & INVEST & REP
  Ops & Money & INVEST --> PG
  Ops & Money & INVEST --> EV
  EV --> RD --> NOTIF --> SMS
  INVEST --> OBJ
  RFID -.-> SCAN
  PAY -.-> LEDGER
  KRA -.-> SALES
```

## Handover with SMS confirmation

```mermaid
sequenceDiagram
  participant G as Giver (driver / wholesaler)
  participant S as System
  participant R as Retailer (registered number)
  G->>S: Scan fulls out + empties in
  S-->>G: Balance check (e.g. 4 out, 4 in, 0 unaccounted)
  G->>S: Request confirmation
  S->>R: SMS with counts, ref and code (15-min window)
  alt Confirmed in time
    R-->>G: Reads code (or replies YES)
    G->>S: Enter code
    S->>S: Custody → retailer; invoice per billing link; events + outbox
  else Replies NO
    S->>S: Freeze, open dispute, alert supervisor
  else No confirmation in 15 min
    S->>S: Unconfirmed: custody stays with giver; alert; case
  end
```

## Money follows confirmed custody

```mermaid
flowchart LR
  H[Confirmed handover<br/>scanned IDs] --> BL{Retailer billing link}
  BL -->|Direct| AR1[Invoice → retailer AR]
  BL -->|Through wholesaler X| AR2[Invoice → wholesaler X AR]
  H -->|Shortfall| SH[Charge giver at value C<br/>+ missing case]
  AR1 & AR2 --> PAYM[Cleared by bank / M-Pesa<br/>or approved credit]
```
