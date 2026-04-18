/** MindBody class object — subset of fields we use from the API response */
export interface MindBodyClass {
  ClassScheduleId: number;
  Id: number;
  ClassName: string;
  StartDateTime: string;
  EndDateTime: string;
  MaxCapacity: number;
  TotalBooked: number;
  IsCanceled: boolean;
  IsAvailable: boolean;
  Staff: {
    DisplayName: string;
    FirstName: string;
    LastName: string;
  };
  Resource: {
    Id: number;
    Name: string;
  };
  ClassDescription: {
    Id: number;
    Name: string;
    Program: {
      Id: number;
      Name: string;
      ScheduleType: string;
    };
    SessionType: {
      Name: string;
    };
  };
  Location: {
    Id: number;
    Name: string;
    SiteID: number;
  };
}

/** Parsed class card data for the trial calendar UI */
export interface TrialClass {
  classScheduleId: number;
  classId: number;
  name: string;
  levelName: string;
  time: string;
  endTime: string;
  date: string;
  dayOfWeek: string;
  coach: string;
  court: string;
  spotsAvailable: number;
  maxCapacity: number;
  recurrence: string;
}

/** A single child in a trial request */
export interface ChildInfo {
  firstName: string;
  age: number;
}

/** Trial request form submission */
export interface TrialRequest {
  parentFirstName: string;
  parentEmail: string;
  /** Required — staff calls within hours to confirm the trial. */
  parentPhone: string;
  childFirstName: string;
  childAge: number;
  children: ChildInfo[];
  locationId: string;
  locationName: string;
  classScheduleId: number;
  className: string;
  classDay: string;
  classTime: string;
  coachName: string;
  notes?: string;
}
