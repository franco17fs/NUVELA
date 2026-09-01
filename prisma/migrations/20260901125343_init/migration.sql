-- CreateEnum
CREATE TYPE "MoneySource" AS ENUM ('MELI_API', 'MP_API', 'BILLING_REPORT', 'MANUAL', 'CALCULATED', 'FORECAST');

-- CreateEnum
CREATE TYPE "ValueKind" AS ENUM ('ACTUAL', 'ESTIMATED', 'FORECAST');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'TOKEN_EXPIRED', 'REVOKED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('MERCADO_LIBRE', 'MERCADO_PAGO');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CONFIRMED', 'PAYMENT_REQUIRED', 'PAYMENT_IN_PROCESS', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'CANCELLED', 'INVALID', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'AUTHORIZED', 'IN_PROCESS', 'IN_MEDIATION', 'REJECTED', 'CANCELLED', 'REFUNDED', 'CHARGED_BACK', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RefundType" AS ENUM ('TOTAL', 'PARTIAL', 'CHARGEBACK', 'CANCELLATION');

-- CreateEnum
CREATE TYPE "FeeType" AS ENUM ('SALE_FEE', 'FIXED_FEE', 'FINANCING_FEE', 'SHIPPING_FEE', 'MARKETPLACE_FEE', 'ADS_ATTRIBUTED', 'TAX_WITHHELD', 'RETURN_COST', 'OTHER');

-- CreateEnum
CREATE TYPE "BillingGroup" AS ENUM ('ML', 'MP');

-- CreateEnum
CREATE TYPE "BillingDocumentType" AS ENUM ('BILL', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "MpRecordType" AS ENUM ('INITIAL_AVAILABLE_BALANCE', 'RELEASE', 'TOTAL', 'AVAILABLE_BALANCE', 'MOVEMENT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CostingMethod" AS ENUM ('WEIGHTED_AVERAGE', 'FIFO');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT', 'INITIAL');

-- CreateEnum
CREATE TYPE "EntryDirection" AS ENUM ('EXPENSE', 'INCOME');

-- CreateEnum
CREATE TYPE "RecurrenceInterval" AS ENUM ('NONE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ObligationStatus" AS ENUM ('UPCOMING', 'PARTIALLY_RESERVED', 'COVERED', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "ObligationPriority" AS ENUM ('CRITICAL', 'HIGH', 'NORMAL', 'LOW');

-- CreateEnum
CREATE TYPE "ReserveType" AS ENUM ('INVENTORY_REPLACEMENT', 'TAX', 'OBLIGATION', 'SAFETY_BUFFER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CashflowKind" AS ENUM ('REAL', 'SCHEDULED', 'ESTIMATED', 'FORECAST');

-- CreateEnum
CREATE TYPE "CashflowDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "ForecastScenario" AS ENUM ('CONSERVATIVE', 'BASE', 'OPTIMISTIC');

-- CreateEnum
CREATE TYPE "ReconciliationIssueType" AS ENUM ('ORDER_WITHOUT_PAYMENT', 'PAYMENT_WITHOUT_ORDER', 'CHARGE_WITHOUT_SALE', 'MOVEMENT_UNIDENTIFIED', 'AMOUNT_MISMATCH', 'MISSING_SHIPMENT_COST', 'REFUND_MISMATCH', 'CHARGEBACK', 'BONUS_UNEXPECTED', 'ADJUSTMENT', 'DUPLICATE_SUSPECTED');

-- CreateEnum
CREATE TYPE "ReconciliationIssueStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "CommercialRuleType" AS ENUM ('SALE_FEE_PERCENTAGE', 'FIXED_FEE_THRESHOLD', 'FREE_SHIPPING_THRESHOLD', 'FINANCING_COST', 'SHIPPING_COST_TABLE', 'OTHER');

-- CreateEnum
CREATE TYPE "TaxCondition" AS ENUM ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL', 'OTRO');

-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('FISCAL_CREDIT', 'COST', 'CASH_MOVEMENT_ONLY', 'LIABILITY');

-- CreateEnum
CREATE TYPE "SyncJobType" AS ENUM ('ORDERS_INCREMENTAL', 'ORDERS_BACKFILL', 'ORDER_DETAIL', 'SHIPMENTS', 'PAYMENTS', 'REFUNDS', 'ADS_DAILY', 'BILLING', 'MP_MOVEMENTS', 'MP_REPORT', 'MISSED_FEEDS', 'RECONCILIATION', 'COSTING');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateTable
CREATE TABLE "SellerAccount" (
    "id" TEXT NOT NULL,
    "mercadoLibreUserId" BIGINT NOT NULL,
    "nickname" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "siteId" TEXT NOT NULL DEFAULT 'MLA',
    "mercadoPagoUserId" BIGINT,
    "advertiserId" BIGINT,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "colorHex" TEXT NOT NULL DEFAULT '#2563eb',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthToken" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiration" TIMESTAMP(3) NOT NULL,
    "scope" TEXT,
    "refreshLockedAt" TIMESTAMP(3),
    "lastRefreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthFlowState" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "redirectTo" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthFlowState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "mlOrderId" BIGINT NOT NULL,
    "packId" BIGINT,
    "status" "OrderStatus" NOT NULL,
    "statusDetail" TEXT,
    "currencyId" TEXT NOT NULL DEFAULT 'ARS',
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "paidAmount" DECIMAL(18,4) NOT NULL,
    "couponAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "shippingCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxesAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "dateCreated" TIMESTAMP(3) NOT NULL,
    "dateClosed" TIMESTAMP(3),
    "dateLastUpdated" TIMESTAMP(3) NOT NULL,
    "businessDate" DATE NOT NULL,
    "buyerId" BIGINT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cancelGroup" TEXT,
    "cancelCode" TEXT,
    "cancelReason" TEXT,
    "refundedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rawPayload" JSONB,
    "source" "MoneySource" NOT NULL DEFAULT 'MELI_API',
    "sourceReferenceId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "mlItemId" TEXT NOT NULL,
    "variationId" TEXT,
    "title" TEXT NOT NULL,
    "categoryId" TEXT,
    "listingTypeId" TEXT,
    "sellerSku" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "grossPrice" DECIMAL(18,4),
    "sellerDiscount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "saleFee" DECIMAL(18,4),
    "saleFeeKind" "ValueKind" NOT NULL DEFAULT 'ACTUAL',
    "saleFeeSource" "MoneySource" NOT NULL DEFAULT 'MELI_API',
    "cogsUnitCost" DECIMAL(18,4),
    "cogsTotal" DECIMAL(18,4),
    "cogsMethod" TEXT,
    "cogsAppliedAt" TIMESTAMP(3),
    "skuId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "orderId" TEXT,
    "mlPaymentId" BIGINT NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "statusDetail" TEXT,
    "currencyId" TEXT NOT NULL DEFAULT 'ARS',
    "transactionAmount" DECIMAL(18,4) NOT NULL,
    "totalPaidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "marketplaceFee" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxesAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "shippingCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "couponAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "overpaidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netReceivedAmount" DECIMAL(18,4),
    "installments" INTEGER,
    "installmentAmount" DECIMAL(18,4),
    "paymentType" TEXT,
    "paymentMethodId" TEXT,
    "operationType" TEXT,
    "dateCreated" TIMESTAMP(3) NOT NULL,
    "dateApproved" TIMESTAMP(3),
    "moneyReleaseDate" TIMESTAMP(3),
    "cashBusinessDate" DATE,
    "rawPayload" JSONB,
    "source" "MoneySource" NOT NULL DEFAULT 'MELI_API',
    "sourceReferenceId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "orderId" TEXT,
    "paymentId" TEXT,
    "externalId" TEXT NOT NULL,
    "type" "RefundType" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currencyId" TEXT NOT NULL DEFAULT 'ARS',
    "reason" TEXT,
    "claimId" BIGINT,
    "returnCost" DECIMAL(18,4),
    "dateCreated" TIMESTAMP(3) NOT NULL,
    "businessDate" DATE NOT NULL,
    "rawPayload" JSONB,
    "source" "MoneySource" NOT NULL DEFAULT 'MELI_API',
    "sourceReferenceId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "orderId" TEXT,
    "mlShipmentId" BIGINT NOT NULL,
    "packId" BIGINT,
    "status" TEXT,
    "substatus" TEXT,
    "logisticType" TEXT,
    "shippingMode" TEXT,
    "grossAmount" DECIMAL(18,4),
    "senderCost" DECIMAL(18,4),
    "receiverCost" DECIMAL(18,4),
    "discountsTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountsDetail" JSONB,
    "billableWeight" INTEGER,
    "dateCreated" TIMESTAMP(3),
    "rawPayload" JSONB,
    "source" "MoneySource" NOT NULL DEFAULT 'MELI_API',
    "sourceReferenceId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceFee" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "orderId" TEXT,
    "type" "FeeType" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currencyId" TEXT NOT NULL DEFAULT 'ARS',
    "kind" "ValueKind" NOT NULL DEFAULT 'ACTUAL',
    "source" "MoneySource" NOT NULL,
    "sourceReferenceId" TEXT,
    "businessDate" DATE NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderProfitability" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "grossRevenue" DECIMAL(18,4) NOT NULL,
    "sellerDiscounts" DECIMAL(18,4) NOT NULL,
    "netRevenue" DECIMAL(18,4) NOT NULL,
    "refunds" DECIMAL(18,4) NOT NULL,
    "cogs" DECIMAL(18,4) NOT NULL,
    "meliFees" DECIMAL(18,4) NOT NULL,
    "fixedFees" DECIMAL(18,4) NOT NULL,
    "financingFees" DECIMAL(18,4) NOT NULL,
    "shippingCost" DECIMAL(18,4) NOT NULL,
    "adsAttributed" DECIMAL(18,4) NOT NULL,
    "taxesWithheld" DECIMAL(18,4) NOT NULL,
    "otherCharges" DECIMAL(18,4) NOT NULL,
    "contributionMargin" DECIMAL(18,4) NOT NULL,
    "marginPct" DECIMAL(9,4) NOT NULL,
    "hasEstimates" BOOLEAN NOT NULL DEFAULT false,
    "breakdown" JSONB NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderProfitability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPeriod" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "group" "BillingGroup" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "dateFrom" TIMESTAMP(3),
    "dateTo" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "status" TEXT,
    "totalAmount" DECIMAL(18,4),
    "currencyId" TEXT NOT NULL DEFAULT 'ARS',
    "rawPayload" JSONB,
    "source" "MoneySource" NOT NULL DEFAULT 'BILLING_REPORT',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingDocument" (
    "id" TEXT NOT NULL,
    "billingPeriodId" TEXT NOT NULL,
    "documentType" "BillingDocumentType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "documentNumber" TEXT,
    "dateIssued" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "currencyId" TEXT NOT NULL DEFAULT 'ARS',
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" TEXT,
    "rawPayload" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingCharge" (
    "id" TEXT NOT NULL,
    "billingDocumentId" TEXT NOT NULL,
    "conceptCode" TEXT,
    "concept" TEXT NOT NULL,
    "detail" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "currencyId" TEXT NOT NULL DEFAULT 'ARS',
    "isBonus" BOOLEAN NOT NULL DEFAULT false,
    "relatedOrderId" BIGINT,
    "relatedItemId" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MercadoPagoMovement" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "paymentId" TEXT,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "recordType" "MpRecordType" NOT NULL DEFAULT 'MOVEMENT',
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "businessDate" DATE NOT NULL,
    "transactionApprovalDate" TIMESTAMP(3),
    "grossAmount" DECIMAL(18,4),
    "netCreditAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netDebitAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "settlementNetAmount" DECIMAL(18,4),
    "balanceAmount" DECIMAL(18,4),
    "mpFeeAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "financingFeeAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "shippingFeeAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "effectiveCouponAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxesAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxDetail" TEXT,
    "taxesDisaggregated" JSONB,
    "currencyId" TEXT NOT NULL DEFAULT 'ARS',
    "mlOrderId" BIGINT,
    "mlShippingId" BIGINT,
    "mlPackId" BIGINT,
    "mlItemId" TEXT,
    "installments" INTEGER,
    "paymentMethod" TEXT,
    "rawPayload" JSONB,
    "source" "MoneySource" NOT NULL DEFAULT 'BILLING_REPORT',
    "sourceReferenceId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MercadoPagoMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MercadoPagoBalanceSnapshot" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "available" DECIMAL(18,4) NOT NULL,
    "pendingRelease" DECIMAL(18,4) NOT NULL,
    "committed" DECIMAL(18,4) NOT NULL,
    "currencyId" TEXT NOT NULL DEFAULT 'ARS',
    "reconciledUntil" TIMESTAMP(3) NOT NULL,
    "source" "MoneySource" NOT NULL DEFAULT 'CALCULATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MercadoPagoBalanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdCampaign" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "mlCampaignId" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "strategy" TEXT,
    "budget" DECIMAL(18,4),
    "acosTarget" DECIMAL(9,4),
    "channel" TEXT,
    "dateCreated" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdGroup" (
    "id" TEXT NOT NULL,
    "adCampaignId" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdMetricDaily" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "adCampaignId" TEXT,
    "adGroupId" TEXT,
    "level" TEXT NOT NULL,
    "mlItemId" TEXT,
    "date" DATE NOT NULL,
    "cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "cpc" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "ctr" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "cvr" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "directUnits" INTEGER NOT NULL DEFAULT 0,
    "indirectUnits" INTEGER NOT NULL DEFAULT 0,
    "totalUnits" INTEGER NOT NULL DEFAULT 0,
    "directAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "indirectAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "organicUnits" INTEGER NOT NULL DEFAULT 0,
    "organicAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "roas" DECIMAL(12,6),
    "acos" DECIMAL(12,6),
    "rawPayload" JSONB,
    "source" "MoneySource" NOT NULL DEFAULT 'MELI_API',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdMetricDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "description" TEXT,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sku" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "barcode" TEXT,
    "billableWeightGrams" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "costingMethod" "CostingMethod" NOT NULL DEFAULT 'WEIGHTED_AVERAGE',
    "currentStock" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currentAverageCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currentStockValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingMapping" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "mlItemId" TEXT NOT NULL,
    "variationId" TEXT,
    "unitsPerListing" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT,
    "skuId" TEXT NOT NULL,
    "type" "InventoryMovementType" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "businessDate" DATE NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "totalCost" DECIMAL(18,4) NOT NULL,
    "stockBefore" DECIMAL(18,4) NOT NULL,
    "stockAfter" DECIMAL(18,4) NOT NULL,
    "avgCostBefore" DECIMAL(18,4) NOT NULL,
    "avgCostAfter" DECIMAL(18,4) NOT NULL,
    "stockValueBefore" DECIMAL(18,4) NOT NULL,
    "stockValueAfter" DECIMAL(18,4) NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "notes" TEXT,
    "source" "MoneySource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostHistory" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "unitCost" DECIMAL(18,4) NOT NULL,
    "averageCost" DECIMAL(18,4) NOT NULL,
    "method" "CostingMethod" NOT NULL DEFAULT 'WEIGHTED_AVERAGE',
    "referenceType" TEXT,
    "referenceId" TEXT,
    "source" "MoneySource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT,
    "supplier" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "businessDate" DATE NOT NULL,
    "invoiceNumber" TEXT,
    "total" DECIMAL(18,4) NOT NULL,
    "currencyId" TEXT NOT NULL DEFAULT 'ARS',
    "paymentMethod" TEXT,
    "paymentDueDate" TIMESTAMP(3),
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "source" "MoneySource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "totalCost" DECIMAL(18,4) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionCategory" (
    "id" TEXT NOT NULL,
    "direction" "EntryDirection" NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "businessDate" DATE NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currencyId" TEXT NOT NULL DEFAULT 'ARS',
    "categoryId" TEXT NOT NULL,
    "subcategory" TEXT,
    "supplier" TEXT,
    "paymentMethod" TEXT,
    "recurrent" BOOLEAN NOT NULL DEFAULT false,
    "recurrence" "RecurrenceInterval" NOT NULL DEFAULT 'NONE',
    "notes" TEXT,
    "attachmentUrl" TEXT,
    "source" "MoneySource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Income" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "businessDate" DATE NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currencyId" TEXT NOT NULL DEFAULT 'ARS',
    "categoryId" TEXT NOT NULL,
    "description" TEXT,
    "recurrent" BOOLEAN NOT NULL DEFAULT false,
    "recurrence" "RecurrenceInterval" NOT NULL DEFAULT 'NONE',
    "notes" TEXT,
    "source" "MoneySource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Income_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Obligation" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currencyId" TEXT NOT NULL DEFAULT 'ARS',
    "dueDate" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "priority" "ObligationPriority" NOT NULL DEFAULT 'NORMAL',
    "recurrent" BOOLEAN NOT NULL DEFAULT false,
    "recurrence" "RecurrenceInterval" NOT NULL DEFAULT 'NONE',
    "installmentsTotal" INTEGER,
    "installmentNumber" INTEGER,
    "status" "ObligationStatus" NOT NULL DEFAULT 'UPCOMING',
    "reservedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "billingDocumentId" TEXT,
    "notes" TEXT,
    "source" "MoneySource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Obligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObligationPayment" (
    "id" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "businessDate" DATE NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "method" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObligationPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reserve" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT,
    "type" "ReserveType" NOT NULL,
    "name" TEXT NOT NULL,
    "targetAmount" DECIMAL(18,4) NOT NULL,
    "currentAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currencyId" TEXT NOT NULL DEFAULT 'ARS',
    "obligationId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reserve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashflowEntry" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT,
    "date" DATE NOT NULL,
    "direction" "CashflowDirection" NOT NULL,
    "kind" "CashflowKind" NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currencyId" TEXT NOT NULL DEFAULT 'ARS',
    "description" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "source" "MoneySource" NOT NULL DEFAULT 'CALCULATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashflowEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Forecast" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT,
    "scenario" "ForecastScenario" NOT NULL,
    "horizonDays" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "assumptions" JSONB,

    CONSTRAINT "Forecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationIssue" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "type" "ReconciliationIssueType" NOT NULL,
    "status" "ReconciliationIssueStatus" NOT NULL DEFAULT 'OPEN',
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "businessDate" DATE NOT NULL,
    "expectedAmount" DECIMAL(18,4),
    "actualAmount" DECIMAL(18,4),
    "difference" DECIMAL(18,4),
    "currencyId" TEXT NOT NULL DEFAULT 'ARS',
    "description" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "resolutionNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialRule" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL DEFAULT 'MLA',
    "ruleType" "CommercialRuleType" NOT NULL,
    "name" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "values" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalProfile" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "condition" "TaxCondition" NOT NULL,
    "cuit" TEXT,
    "province" TEXT NOT NULL,
    "iibbStatus" TEXT,
    "sirtacStatus" TEXT,
    "rates" JSONB NOT NULL,
    "treatments" JSONB NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT,
    "type" "SyncJobType" NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "windowFrom" TIMESTAMP(3),
    "windowTo" TIMESTAMP(3),
    "itemsRead" INTEGER NOT NULL DEFAULT 0,
    "itemsWritten" INTEGER NOT NULL DEFAULT 0,
    "itemsSkipped" INTEGER NOT NULL DEFAULT 0,
    "rateLimitHits" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "errorDetail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCursor" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "type" "SyncJobType" NOT NULL,
    "lastWatermark" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "cursorData" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "sellerAccountId" TEXT,
    "provider" "Provider" NOT NULL DEFAULT 'MERCADO_LIBRE',
    "topic" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "mlUserId" BIGINT,
    "applicationId" BIGINT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processAttempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "errorMessage" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SellerAccount_mercadoLibreUserId_key" ON "SellerAccount"("mercadoLibreUserId");

-- CreateIndex
CREATE INDEX "SellerAccount_status_idx" ON "SellerAccount"("status");

-- CreateIndex
CREATE INDEX "OAuthToken_tokenExpiration_idx" ON "OAuthToken"("tokenExpiration");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthToken_sellerAccountId_provider_key" ON "OAuthToken"("sellerAccountId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthFlowState_state_key" ON "OAuthFlowState"("state");

-- CreateIndex
CREATE INDEX "OAuthFlowState_expiresAt_idx" ON "OAuthFlowState"("expiresAt");

-- CreateIndex
CREATE INDEX "Order_sellerAccountId_businessDate_idx" ON "Order"("sellerAccountId", "businessDate");

-- CreateIndex
CREATE INDEX "Order_sellerAccountId_dateLastUpdated_idx" ON "Order"("sellerAccountId", "dateLastUpdated");

-- CreateIndex
CREATE INDEX "Order_sellerAccountId_status_idx" ON "Order"("sellerAccountId", "status");

-- CreateIndex
CREATE INDEX "Order_packId_idx" ON "Order"("packId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_sellerAccountId_mlOrderId_key" ON "Order"("sellerAccountId", "mlOrderId");

-- CreateIndex
CREATE INDEX "OrderItem_mlItemId_idx" ON "OrderItem"("mlItemId");

-- CreateIndex
CREATE INDEX "OrderItem_skuId_idx" ON "OrderItem"("skuId");

-- CreateIndex
CREATE INDEX "OrderItem_sellerSku_idx" ON "OrderItem"("sellerSku");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_position_key" ON "OrderItem"("orderId", "position");

-- CreateIndex
CREATE INDEX "Payment_sellerAccountId_moneyReleaseDate_idx" ON "Payment"("sellerAccountId", "moneyReleaseDate");

-- CreateIndex
CREATE INDEX "Payment_sellerAccountId_status_idx" ON "Payment"("sellerAccountId", "status");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_sellerAccountId_mlPaymentId_key" ON "Payment"("sellerAccountId", "mlPaymentId");

-- CreateIndex
CREATE INDEX "Refund_sellerAccountId_businessDate_idx" ON "Refund"("sellerAccountId", "businessDate");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_sellerAccountId_externalId_key" ON "Refund"("sellerAccountId", "externalId");

-- CreateIndex
CREATE INDEX "Shipment_orderId_idx" ON "Shipment"("orderId");

-- CreateIndex
CREATE INDEX "Shipment_packId_idx" ON "Shipment"("packId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_sellerAccountId_mlShipmentId_key" ON "Shipment"("sellerAccountId", "mlShipmentId");

-- CreateIndex
CREATE INDEX "MarketplaceFee_sellerAccountId_businessDate_type_idx" ON "MarketplaceFee"("sellerAccountId", "businessDate", "type");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceFee_sellerAccountId_orderId_type_source_key" ON "MarketplaceFee"("sellerAccountId", "orderId", "type", "source");

-- CreateIndex
CREATE UNIQUE INDEX "OrderProfitability_orderId_key" ON "OrderProfitability"("orderId");

-- CreateIndex
CREATE INDEX "BillingPeriod_sellerAccountId_dueDate_idx" ON "BillingPeriod"("sellerAccountId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPeriod_sellerAccountId_group_periodKey_key" ON "BillingPeriod"("sellerAccountId", "group", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "BillingDocument_billingPeriodId_externalId_key" ON "BillingDocument"("billingPeriodId", "externalId");

-- CreateIndex
CREATE INDEX "BillingCharge_billingDocumentId_idx" ON "BillingCharge"("billingDocumentId");

-- CreateIndex
CREATE INDEX "BillingCharge_relatedOrderId_idx" ON "BillingCharge"("relatedOrderId");

-- CreateIndex
CREATE INDEX "MercadoPagoMovement_sellerAccountId_businessDate_idx" ON "MercadoPagoMovement"("sellerAccountId", "businessDate");

-- CreateIndex
CREATE INDEX "MercadoPagoMovement_sellerAccountId_recordType_date_idx" ON "MercadoPagoMovement"("sellerAccountId", "recordType", "date");

-- CreateIndex
CREATE INDEX "MercadoPagoMovement_mlOrderId_idx" ON "MercadoPagoMovement"("mlOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "MercadoPagoMovement_sellerAccountId_externalId_key" ON "MercadoPagoMovement"("sellerAccountId", "externalId");

-- CreateIndex
CREATE INDEX "MercadoPagoBalanceSnapshot_sellerAccountId_createdAt_idx" ON "MercadoPagoBalanceSnapshot"("sellerAccountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdCampaign_sellerAccountId_mlCampaignId_key" ON "AdCampaign"("sellerAccountId", "mlCampaignId");

-- CreateIndex
CREATE UNIQUE INDEX "AdGroup_adCampaignId_name_key" ON "AdGroup"("adCampaignId", "name");

-- CreateIndex
CREATE INDEX "AdMetricDaily_sellerAccountId_date_idx" ON "AdMetricDaily"("sellerAccountId", "date");

-- CreateIndex
CREATE INDEX "AdMetricDaily_mlItemId_date_idx" ON "AdMetricDaily"("mlItemId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AdMetricDaily_sellerAccountId_level_adCampaignId_mlItemId_d_key" ON "AdMetricDaily"("sellerAccountId", "level", "adCampaignId", "mlItemId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Sku_code_key" ON "Sku"("code");

-- CreateIndex
CREATE INDEX "Sku_productId_idx" ON "Sku"("productId");

-- CreateIndex
CREATE INDEX "Sku_active_idx" ON "Sku"("active");

-- CreateIndex
CREATE INDEX "ListingMapping_skuId_idx" ON "ListingMapping"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "ListingMapping_sellerAccountId_mlItemId_variationId_key" ON "ListingMapping"("sellerAccountId", "mlItemId", "variationId");

-- CreateIndex
CREATE INDEX "InventoryMovement_skuId_date_idx" ON "InventoryMovement"("skuId", "date");

-- CreateIndex
CREATE INDEX "InventoryMovement_businessDate_idx" ON "InventoryMovement"("businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_referenceType_referenceId_key" ON "InventoryMovement"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "CostHistory_skuId_validFrom_idx" ON "CostHistory"("skuId", "validFrom");

-- CreateIndex
CREATE INDEX "Purchase_businessDate_idx" ON "Purchase"("businessDate");

-- CreateIndex
CREATE INDEX "Purchase_supplier_idx" ON "Purchase"("supplier");

-- CreateIndex
CREATE INDEX "PurchaseItem_purchaseId_idx" ON "PurchaseItem"("purchaseId");

-- CreateIndex
CREATE INDEX "PurchaseItem_skuId_idx" ON "PurchaseItem"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionCategory_direction_name_parentId_key" ON "TransactionCategory"("direction", "name", "parentId");

-- CreateIndex
CREATE INDEX "Expense_businessDate_idx" ON "Expense"("businessDate");

-- CreateIndex
CREATE INDEX "Expense_categoryId_idx" ON "Expense"("categoryId");

-- CreateIndex
CREATE INDEX "Income_businessDate_idx" ON "Income"("businessDate");

-- CreateIndex
CREATE INDEX "Obligation_dueDate_status_idx" ON "Obligation"("dueDate", "status");

-- CreateIndex
CREATE INDEX "Obligation_sellerAccountId_dueDate_idx" ON "Obligation"("sellerAccountId", "dueDate");

-- CreateIndex
CREATE INDEX "ObligationPayment_obligationId_idx" ON "ObligationPayment"("obligationId");

-- CreateIndex
CREATE INDEX "ObligationPayment_businessDate_idx" ON "ObligationPayment"("businessDate");

-- CreateIndex
CREATE INDEX "Reserve_sellerAccountId_active_idx" ON "Reserve"("sellerAccountId", "active");

-- CreateIndex
CREATE INDEX "CashflowEntry_sellerAccountId_date_idx" ON "CashflowEntry"("sellerAccountId", "date");

-- CreateIndex
CREATE INDEX "CashflowEntry_date_kind_idx" ON "CashflowEntry"("date", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "CashflowEntry_referenceType_referenceId_direction_key" ON "CashflowEntry"("referenceType", "referenceId", "direction");

-- CreateIndex
CREATE INDEX "Forecast_sellerAccountId_generatedAt_idx" ON "Forecast"("sellerAccountId", "generatedAt");

-- CreateIndex
CREATE INDEX "ReconciliationIssue_sellerAccountId_status_businessDate_idx" ON "ReconciliationIssue"("sellerAccountId", "status", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationIssue_sellerAccountId_fingerprint_key" ON "ReconciliationIssue"("sellerAccountId", "fingerprint");

-- CreateIndex
CREATE INDEX "CommercialRule_siteId_ruleType_validFrom_idx" ON "CommercialRule"("siteId", "ruleType", "validFrom");

-- CreateIndex
CREATE INDEX "FiscalProfile_sellerAccountId_validFrom_idx" ON "FiscalProfile"("sellerAccountId", "validFrom");

-- CreateIndex
CREATE INDEX "SyncJob_sellerAccountId_type_startedAt_idx" ON "SyncJob"("sellerAccountId", "type", "startedAt");

-- CreateIndex
CREATE INDEX "SyncJob_status_idx" ON "SyncJob"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SyncCursor_sellerAccountId_type_key" ON "SyncCursor"("sellerAccountId", "type");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_sellerAccountId_topic_idx" ON "WebhookEvent"("sellerAccountId", "topic");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_topic_resource_sentAt_key" ON "WebhookEvent"("provider", "topic", "resource", "sentAt");

-- AddForeignKey
ALTER TABLE "OAuthToken" ADD CONSTRAINT "OAuthToken_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceFee" ADD CONSTRAINT "MarketplaceFee_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceFee" ADD CONSTRAINT "MarketplaceFee_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderProfitability" ADD CONSTRAINT "OrderProfitability_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPeriod" ADD CONSTRAINT "BillingPeriod_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingDocument" ADD CONSTRAINT "BillingDocument_billingPeriodId_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "BillingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCharge" ADD CONSTRAINT "BillingCharge_billingDocumentId_fkey" FOREIGN KEY ("billingDocumentId") REFERENCES "BillingDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MercadoPagoMovement" ADD CONSTRAINT "MercadoPagoMovement_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MercadoPagoMovement" ADD CONSTRAINT "MercadoPagoMovement_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdGroup" ADD CONSTRAINT "AdGroup_adCampaignId_fkey" FOREIGN KEY ("adCampaignId") REFERENCES "AdCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdMetricDaily" ADD CONSTRAINT "AdMetricDaily_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdMetricDaily" ADD CONSTRAINT "AdMetricDaily_adCampaignId_fkey" FOREIGN KEY ("adCampaignId") REFERENCES "AdCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdMetricDaily" ADD CONSTRAINT "AdMetricDaily_adGroupId_fkey" FOREIGN KEY ("adGroupId") REFERENCES "AdGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sku" ADD CONSTRAINT "Sku_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingMapping" ADD CONSTRAINT "ListingMapping_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingMapping" ADD CONSTRAINT "ListingMapping_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostHistory" ADD CONSTRAINT "CostHistory_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionCategory" ADD CONSTRAINT "TransactionCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TransactionCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TransactionCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TransactionCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObligationPayment" ADD CONSTRAINT "ObligationPayment_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reserve" ADD CONSTRAINT "Reserve_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reserve" ADD CONSTRAINT "Reserve_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashflowEntry" ADD CONSTRAINT "CashflowEntry_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Forecast" ADD CONSTRAINT "Forecast_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationIssue" ADD CONSTRAINT "ReconciliationIssue_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalProfile" ADD CONSTRAINT "FiscalProfile_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncCursor" ADD CONSTRAINT "SyncCursor_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_sellerAccountId_fkey" FOREIGN KEY ("sellerAccountId") REFERENCES "SellerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
