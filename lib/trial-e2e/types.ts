export type TrialE2EStageSystem =
  | "application"
  | "crm_fixture"
  | "mindbody_fixture"
  | "notification_guard";

export interface TrialE2EStage {
  key: string;
  label: string;
  system: TrialE2EStageSystem;
  status: "passed" | "cached";
  at: string;
  evidence: string;
}

export interface TrialE2EReceipt {
  version: 1;
  purpose: "trial_e2e_receipt";
  audience: string;
  mode: "fixture" | "mindbody_sandbox";
  runId: string;
  submissionId: string;
  state: "pending_staff" | "confirmed";
  issuedAt: string;
  expiresAt: string;
  classSelection: {
    classId: number;
    classScheduleId: number;
    className: string;
    startsAt: string;
  };
  ids: {
    contactId: string;
    dealId: string;
    parentClientId: string;
    childClientId: string;
    relationshipId: string;
    saleId?: string;
    visitId?: string;
  };
  notificationEvidence: {
    hubspotAdapterInvoked: false;
    staffNotifierInvoked: false;
    adminNotifierInvoked: false;
    mindbodyClientCommunicationFlags: "not_applicable" | "all_false";
    mindbodyClassSendEmail: "not_applicable" | "false";
    externalDeliveryObservation: "not_observed";
  };
  confirmationAttempts: number;
  stages: TrialE2EStage[];
  verificationScope: string[];
  limitations: string[];
}

export interface TrialE2ERunResponse {
  ok: true;
  cached: boolean;
  status: TrialE2EReceipt["state"];
  receiptToken: string;
  receipt: TrialE2EReceipt;
}
