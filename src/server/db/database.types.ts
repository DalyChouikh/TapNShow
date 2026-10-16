
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "abuse_reports": {
                  Row: {
                    "contact_id": string | null,"id": string,"invitee_id": string | null,"reported_at": string,"reviewed_at": string | null,"reviewed_by": string | null,"workspace_id": string
                  }
                  Insert: {
                    "contact_id"?: string | null,"id"?: string,"invitee_id"?: string | null,"reported_at"?: string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "contact_id"?: string | null,"id"?: string,"invitee_id"?: string | null,"reported_at"?: string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "abuse_reports_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "abuse_reports_invitee_id_fkey"
      columns: ["invitee_id"]
isOneToOne: true
      referencedRelation: "meeting_invitees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "abuse_reports_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"attendance_marks": {
                  Row: {
                    "actual": Database["public"]['Enums']["attendance_actual"],"invitee_id": string,"late_minutes": number | null,"marked_at": string,"marked_by": string | null,"meeting_id": string,"workspace_id": string
                  }
                  Insert: {
                    "actual": Database["public"]['Enums']["attendance_actual"],"invitee_id": string,"late_minutes"?: number | null,"marked_at"?: string,"marked_by"?: string | null,"meeting_id": string,"workspace_id": string
                  }
                  Update: {
                    "actual"?: Database["public"]['Enums']["attendance_actual"],"invitee_id"?: string,"late_minutes"?: number | null,"marked_at"?: string,"marked_by"?: string | null,"meeting_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attendance_marks_invitee_id_fkey"
      columns: ["invitee_id"]
isOneToOne: true
      referencedRelation: "meeting_invitees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attendance_marks_meeting_id_workspace_id_fkey"
      columns: ["meeting_id","workspace_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"contacts": {
                  Row: {
                    "created_at": string,"email": string,"full_name": string,"id": string,"is_adhoc": boolean,"unsubscribed_at": string | null,"unsubscribed_via": Database["public"]['Enums']["unsubscribe_via"] | null,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "created_at"?: string,"email": string,"full_name": string,"id"?: string,"is_adhoc"?: boolean,"unsubscribed_at"?: string | null,"unsubscribed_via"?: Database["public"]['Enums']["unsubscribe_via"] | null,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"full_name"?: string,"id"?: string,"is_adhoc"?: boolean,"unsubscribed_at"?: string | null,"unsubscribed_via"?: Database["public"]['Enums']["unsubscribe_via"] | null,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"google_connections": {
                  Row: {
                    "broken_at": string | null,"broken_reason": string | null,"created_at": string,"google_email": string,"google_sub": string,"granted_scopes": (string)[],"id": string,"refresh_token_encrypted": string,"status": Database["public"]['Enums']["connection_status"],"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "broken_at"?: string | null,"broken_reason"?: string | null,"created_at"?: string,"google_email": string,"google_sub": string,"granted_scopes": (string)[],"id"?: string,"refresh_token_encrypted": string,"status"?: Database["public"]['Enums']["connection_status"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "broken_at"?: string | null,"broken_reason"?: string | null,"created_at"?: string,"google_email"?: string,"google_sub"?: string,"granted_scopes"?: (string)[],"id"?: string,"refresh_token_encrypted"?: string,"status"?: Database["public"]['Enums']["connection_status"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"list_contacts": {
                  Row: {
                    "contact_id": string,"created_at": string,"list_id": string,"workspace_id": string
                  }
                  Insert: {
                    "contact_id": string,"created_at"?: string,"list_id": string,"workspace_id": string
                  }
                  Update: {
                    "contact_id"?: string,"created_at"?: string,"list_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "list_contacts_contact_id_workspace_id_fkey"
      columns: ["contact_id","workspace_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "list_contacts_list_id_workspace_id_fkey"
      columns: ["list_id","workspace_id"]
isOneToOne: false
      referencedRelation: "lists"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"lists": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lists_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"meeting_audience": {
                  Row: {
                    "list_id": string,"meeting_id": string,"workspace_id": string
                  }
                  Insert: {
                    "list_id": string,"meeting_id": string,"workspace_id": string
                  }
                  Update: {
                    "list_id"?: string,"meeting_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_audience_list_id_workspace_id_fkey"
      columns: ["list_id","workspace_id"]
isOneToOne: false
      referencedRelation: "lists"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "meeting_audience_meeting_id_workspace_id_fkey"
      columns: ["meeting_id","workspace_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"meeting_audience_people": {
                  Row: {
                    "contact_id": string,"meeting_id": string,"mode": Database["public"]['Enums']["audience_mode"],"workspace_id": string
                  }
                  Insert: {
                    "contact_id": string,"meeting_id": string,"mode": Database["public"]['Enums']["audience_mode"],"workspace_id": string
                  }
                  Update: {
                    "contact_id"?: string,"meeting_id"?: string,"mode"?: Database["public"]['Enums']["audience_mode"],"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_audience_people_contact_id_workspace_id_fkey"
      columns: ["contact_id","workspace_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "meeting_audience_people_meeting_id_workspace_id_fkey"
      columns: ["meeting_id","workspace_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"meeting_changes": {
                  Row: {
                    "changed_at": string,"changed_by": string | null,"changes": NonNullable<Json>,"id": string,"kind": Database["public"]['Enums']["meeting_change_kind"],"meeting_id": string,"notified": boolean,"workspace_id": string
                  }
                  Insert: {
                    "changed_at"?: string,"changed_by"?: string | null,"changes"?: NonNullable<Json>,"id"?: string,"kind": Database["public"]['Enums']["meeting_change_kind"],"meeting_id": string,"notified": boolean,"workspace_id": string
                  }
                  Update: {
                    "changed_at"?: string,"changed_by"?: string | null,"changes"?: NonNullable<Json>,"id"?: string,"kind"?: Database["public"]['Enums']["meeting_change_kind"],"meeting_id"?: string,"notified"?: boolean,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_changes_meeting_id_workspace_id_fkey"
      columns: ["meeting_id","workspace_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"meeting_invitees": {
                  Row: {
                    "calendar_requested_at": string | null,"calendar_sequence": number,"calendar_state": Database["public"]['Enums']["calendar_state"],"contact_id": string,"details_told_at": string | null,"email_error": string | null,"email_status": Database["public"]['Enums']["invitee_email_status"],"id": string,"invited_at": string,"meeting_id": string,"sent_at": string | null,"token_hash": string | null,"workspace_id": string
                  }
                  Insert: {
                    "calendar_requested_at"?: string | null,"calendar_sequence"?: number,"calendar_state"?: Database["public"]['Enums']["calendar_state"],"contact_id": string,"details_told_at"?: string | null,"email_error"?: string | null,"email_status"?: Database["public"]['Enums']["invitee_email_status"],"id"?: string,"invited_at"?: string,"meeting_id": string,"sent_at"?: string | null,"token_hash"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "calendar_requested_at"?: string | null,"calendar_sequence"?: number,"calendar_state"?: Database["public"]['Enums']["calendar_state"],"contact_id"?: string,"details_told_at"?: string | null,"email_error"?: string | null,"email_status"?: Database["public"]['Enums']["invitee_email_status"],"id"?: string,"invited_at"?: string,"meeting_id"?: string,"sent_at"?: string | null,"token_hash"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_invitees_contact_id_workspace_id_fkey"
      columns: ["contact_id","workspace_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "meeting_invitees_meeting_id_workspace_id_fkey"
      columns: ["meeting_id","workspace_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"meetings": {
                  Row: {
                    "agenda_md": string,"cancelled_at": string | null,"comments_enabled": boolean,"created_at": string,"created_by": string | null,"delay_options": (number)[],"duration_minutes": number,"footer_note": string,"gmail_root_message_id": string | null,"gmail_thread_id": string | null,"ics_sequence": number,"ics_uid": string,"id": string,"last_nudged_at": string | null,"last_nudged_count": number | null,"location_mode": Database["public"]['Enums']["location_mode"],"location_text": string,"meeting_url": string,"online_text": string,"reason_required": boolean,"reminder_going_hours": number | null,"reminder_pending_hours": number | null,"response_deadline": string | null,"response_mode": Database["public"]['Enums']["response_mode"],"sent_at": string | null,"starts_at": string | null,"status": Database["public"]['Enums']["meeting_status"],"thread_connection_id": string | null,"timezone": string,"title": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "agenda_md"?: string,"cancelled_at"?: string | null,"comments_enabled": boolean,"created_at"?: string,"created_by"?: string | null,"delay_options"?: (number)[],"duration_minutes": number,"footer_note"?: string,"gmail_root_message_id"?: string | null,"gmail_thread_id"?: string | null,"ics_sequence"?: number,"ics_uid"?: string,"id"?: string,"last_nudged_at"?: string | null,"last_nudged_count"?: number | null,"location_mode"?: Database["public"]['Enums']["location_mode"],"location_text"?: string,"meeting_url"?: string,"online_text"?: string,"reason_required": boolean,"reminder_going_hours"?: number | null,"reminder_pending_hours"?: number | null,"response_deadline"?: string | null,"response_mode": Database["public"]['Enums']["response_mode"],"sent_at"?: string | null,"starts_at"?: string | null,"status"?: Database["public"]['Enums']["meeting_status"],"thread_connection_id"?: string | null,"timezone": string,"title"?: string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "agenda_md"?: string,"cancelled_at"?: string | null,"comments_enabled"?: boolean,"created_at"?: string,"created_by"?: string | null,"delay_options"?: (number)[],"duration_minutes"?: number,"footer_note"?: string,"gmail_root_message_id"?: string | null,"gmail_thread_id"?: string | null,"ics_sequence"?: number,"ics_uid"?: string,"id"?: string,"last_nudged_at"?: string | null,"last_nudged_count"?: number | null,"location_mode"?: Database["public"]['Enums']["location_mode"],"location_text"?: string,"meeting_url"?: string,"online_text"?: string,"reason_required"?: boolean,"reminder_going_hours"?: number | null,"reminder_pending_hours"?: number | null,"response_deadline"?: string | null,"response_mode"?: Database["public"]['Enums']["response_mode"],"sent_at"?: string | null,"starts_at"?: string | null,"status"?: Database["public"]['Enums']["meeting_status"],"thread_connection_id"?: string | null,"timezone"?: string,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meetings_thread_connection_id_fkey"
      columns: ["thread_connection_id"]
isOneToOne: false
      referencedRelation: "google_connections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meetings_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"outbox_jobs": {
                  Row: {
                    "attempts": number,"created_at": string,"id": string,"idempotency_key": string,"invitee_id": string | null,"kind": Database["public"]['Enums']["job_kind"],"last_error": string | null,"locked_until": string | null,"meeting_id": string | null,"payload": NonNullable<Json>,"run_after": string,"run_id": string | null,"send_started_at": string | null,"status": Database["public"]['Enums']["job_status"],"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"id"?: string,"idempotency_key": string,"invitee_id"?: string | null,"kind": Database["public"]['Enums']["job_kind"],"last_error"?: string | null,"locked_until"?: string | null,"meeting_id"?: string | null,"payload"?: NonNullable<Json>,"run_after"?: string,"run_id"?: string | null,"send_started_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"id"?: string,"idempotency_key"?: string,"invitee_id"?: string | null,"kind"?: Database["public"]['Enums']["job_kind"],"last_error"?: string | null,"locked_until"?: string | null,"meeting_id"?: string | null,"payload"?: NonNullable<Json>,"run_after"?: string,"run_id"?: string | null,"send_started_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "outbox_jobs_invitee_id_fkey"
      columns: ["invitee_id"]
isOneToOne: false
      referencedRelation: "meeting_invitees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "outbox_jobs_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "outbox_jobs_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"platform_admin_invites": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"created_at": string,"email": string,"expires_at": string,"id": string,"invited_by": string | null,"revoked_at": string | null,"token_hash": string,"updated_at": string
                  }
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"email": string,"expires_at": string,"id"?: string,"invited_by"?: string | null,"revoked_at"?: string | null,"token_hash": string,"updated_at"?: string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"revoked_at"?: string | null,"token_hash"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"platform_admins": {
                  Row: {
                    "added_by": string | null,"created_at": string,"role": Database["public"]['Enums']["platform_role"],"user_id": string
                  }
                  Insert: {
                    "added_by"?: string | null,"created_at"?: string,"role"?: Database["public"]['Enums']["platform_role"],"user_id": string
                  }
                  Update: {
                    "added_by"?: string | null,"created_at"?: string,"role"?: Database["public"]['Enums']["platform_role"],"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"platform_daily": {
                  Row: {
                    "day": string,"emails_failed": number,"emails_sent": number,"people_emailed": number,"pushes_failed": number,"pushes_sent": number,"workspace_id": string
                  }
                  Insert: {
                    "day": string,"emails_failed"?: number,"emails_sent"?: number,"people_emailed"?: number,"pushes_failed"?: number,"pushes_sent"?: number,"workspace_id": string
                  }
                  Update: {
                    "day"?: string,"emails_failed"?: number,"emails_sent"?: number,"people_emailed"?: number,"pushes_failed"?: number,"pushes_sent"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "platform_daily_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"platform_events": {
                  Row: {
                    "actor_id": string | null,"created_at": string,"emailed_at": string | null,"facts": NonNullable<Json>,"id": number,"kind": Database["public"]['Enums']["platform_event_kind"],"locked_until": string | null,"notified_at": string | null,"notify_attempts": number,"workspace_id": string | null,"workspace_name": string | null
                  }
                  Insert: {
                    "actor_id"?: string | null,"created_at"?: string,"emailed_at"?: string | null,"facts"?: NonNullable<Json>,"id"?: never,"kind": Database["public"]['Enums']["platform_event_kind"],"locked_until"?: string | null,"notified_at"?: string | null,"notify_attempts"?: number,"workspace_id"?: string | null,"workspace_name"?: string | null
                  }
                  Update: {
                    "actor_id"?: string | null,"created_at"?: string,"emailed_at"?: string | null,"facts"?: NonNullable<Json>,"id"?: never,"kind"?: Database["public"]['Enums']["platform_event_kind"],"locked_until"?: string | null,"notified_at"?: string | null,"notify_attempts"?: number,"workspace_id"?: string | null,"workspace_name"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "platform_events_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"platform_rollup_state": {
                  Row: {
                    "id": boolean,"rolled_through": string
                  }
                  Insert: {
                    "id"?: boolean,"rolled_through": string
                  }
                  Update: {
                    "id"?: boolean,"rolled_through"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"display_name": string | null,"last_workspace_id": string | null,"locale": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"last_workspace_id"?: string | null,"locale"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"last_workspace_id"?: string | null,"locale"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_last_workspace_id_fkey"
      columns: ["last_workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"push_deliveries": {
                  Row: {
                    "attempts": number,"audience": string | null,"created_at": string,"id": string,"invitee_id": string,"job_id": string,"kind": Database["public"]['Enums']["push_kind"],"locked_until": string | null,"run_after": string,"run_id": string | null,"subscription_id": string
                  }
                  Insert: {
                    "attempts"?: number,"audience"?: string | null,"created_at"?: string,"id"?: string,"invitee_id": string,"job_id": string,"kind": Database["public"]['Enums']["push_kind"],"locked_until"?: string | null,"run_after"?: string,"run_id"?: string | null,"subscription_id": string
                  }
                  Update: {
                    "attempts"?: number,"audience"?: string | null,"created_at"?: string,"id"?: string,"invitee_id"?: string,"job_id"?: string,"kind"?: Database["public"]['Enums']["push_kind"],"locked_until"?: string | null,"run_after"?: string,"run_id"?: string | null,"subscription_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "push_deliveries_invitee_id_fkey"
      columns: ["invitee_id"]
isOneToOne: false
      referencedRelation: "meeting_invitees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "push_deliveries_subscription_id_fkey"
      columns: ["subscription_id"]
isOneToOne: false
      referencedRelation: "push_subscriptions"
      referencedColumns: ["id"]
    }
                  ]
                },"push_subscriptions": {
                  Row: {
                    "auth": string,"created_at": string,"endpoint": string,"id": string,"last_active_at": string | null,"last_seen_at": string,"last_success_at": string | null,"p256dh": string,"user_id": string
                  }
                  Insert: {
                    "auth": string,"created_at"?: string,"endpoint": string,"id"?: string,"last_active_at"?: never,"last_seen_at"?: string,"last_success_at"?: string | null,"p256dh": string,"user_id": string
                  }
                  Update: {
                    "auth"?: string,"created_at"?: string,"endpoint"?: string,"id"?: string,"last_active_at"?: never,"last_seen_at"?: string,"last_success_at"?: string | null,"p256dh"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"response_history": {
                  Row: {
                    "after_deadline": boolean,"changed_at": string,"comment": string,"delay_minutes": number | null,"id": number,"invitee_id": string,"meeting_id": string,"reason": string,"response_id": string,"status": Database["public"]['Enums']["response_status"],"workspace_id": string
                  }
                  Insert: {
                    "after_deadline": boolean,"changed_at"?: string,"comment"?: string,"delay_minutes"?: number | null,"id"?: never,"invitee_id": string,"meeting_id": string,"reason"?: string,"response_id": string,"status": Database["public"]['Enums']["response_status"],"workspace_id": string
                  }
                  Update: {
                    "after_deadline"?: boolean,"changed_at"?: string,"comment"?: string,"delay_minutes"?: number | null,"id"?: never,"invitee_id"?: string,"meeting_id"?: string,"reason"?: string,"response_id"?: string,"status"?: Database["public"]['Enums']["response_status"],"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "response_history_invitee_id_fkey"
      columns: ["invitee_id"]
isOneToOne: false
      referencedRelation: "meeting_invitees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "response_history_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "response_history_response_id_fkey"
      columns: ["response_id"]
isOneToOne: false
      referencedRelation: "responses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "response_history_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"responses": {
                  Row: {
                    "after_deadline": boolean,"comment": string,"delay_minutes": number | null,"id": string,"invitee_id": string,"meeting_id": string,"needs_reconfirmation": boolean,"reason": string,"responded_at": string,"status": Database["public"]['Enums']["response_status"],"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "after_deadline"?: boolean,"comment"?: string,"delay_minutes"?: number | null,"id"?: string,"invitee_id": string,"meeting_id": string,"needs_reconfirmation"?: boolean,"reason"?: string,"responded_at"?: string,"status": Database["public"]['Enums']["response_status"],"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "after_deadline"?: boolean,"comment"?: string,"delay_minutes"?: number | null,"id"?: string,"invitee_id"?: string,"meeting_id"?: string,"needs_reconfirmation"?: boolean,"reason"?: string,"responded_at"?: string,"status"?: Database["public"]['Enums']["response_status"],"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "responses_invitee_id_fkey"
      columns: ["invitee_id"]
isOneToOne: true
      referencedRelation: "meeting_invitees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "responses_meeting_id_workspace_id_fkey"
      columns: ["meeting_id","workspace_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"send_log": {
                  Row: {
                    "google_sub": string,"id": number,"job_id": string | null,"sent_at": string,"workspace_id": string | null
                  }
                  Insert: {
                    "google_sub": string,"id"?: never,"job_id"?: string | null,"sent_at"?: string,"workspace_id"?: string | null
                  }
                  Update: {
                    "google_sub"?: string,"id"?: never,"job_id"?: string | null,"sent_at"?: string,"workspace_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "send_log_job_fk"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "outbox_jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "send_log_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"sender_leases": {
                  Row: {
                    "google_sub": string,"locked_until": string,"run_id": string
                  }
                  Insert: {
                    "google_sub": string,"locked_until": string,"run_id": string
                  }
                  Update: {
                    "google_sub"?: string,"locked_until"?: string,"run_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"sheet_dirty_years": {
                  Row: {
                    "changed_at": string,"first_changed_at": string,"version": number,"workspace_id": string,"year": number
                  }
                  Insert: {
                    "changed_at"?: string,"first_changed_at"?: string,"version"?: number,"workspace_id": string,"year": number
                  }
                  Update: {
                    "changed_at"?: string,"first_changed_at"?: string,"version"?: number,"workspace_id"?: string,"year"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "sheet_dirty_years_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "sheet_syncs"
      referencedColumns: ["workspace_id"]
    }
                  ]
                },"sheet_syncs": {
                  Row: {
                    "alerted_at": string | null,"attempts": number,"connection_id": string | null,"create_key": string,"created_at": string,"created_by": string | null,"google_email": string,"google_sub": string,"last_error": string | null,"locked_until": string | null,"paused_at": string | null,"paused_reason": Database["public"]['Enums']["sheet_pause_reason"] | null,"retry_at": string,"run_id": string | null,"spreadsheet_id": string | null,"status": Database["public"]['Enums']["sheet_status"],"synced_at": string | null,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "alerted_at"?: string | null,"attempts"?: number,"connection_id"?: string | null,"create_key"?: string,"created_at"?: string,"created_by"?: string | null,"google_email": string,"google_sub": string,"last_error"?: string | null,"locked_until"?: string | null,"paused_at"?: string | null,"paused_reason"?: Database["public"]['Enums']["sheet_pause_reason"] | null,"retry_at"?: string,"run_id"?: string | null,"spreadsheet_id"?: string | null,"status"?: Database["public"]['Enums']["sheet_status"],"synced_at"?: string | null,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "alerted_at"?: string | null,"attempts"?: number,"connection_id"?: string | null,"create_key"?: string,"created_at"?: string,"created_by"?: string | null,"google_email"?: string,"google_sub"?: string,"last_error"?: string | null,"locked_until"?: string | null,"paused_at"?: string | null,"paused_reason"?: Database["public"]['Enums']["sheet_pause_reason"] | null,"retry_at"?: string,"run_id"?: string | null,"spreadsheet_id"?: string | null,"status"?: Database["public"]['Enums']["sheet_status"],"synced_at"?: string | null,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sheet_syncs_connection_id_fkey"
      columns: ["connection_id"]
isOneToOne: false
      referencedRelation: "google_connections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sheet_syncs_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: true
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"sheet_tabs": {
                  Row: {
                    "content_hash": string,"created_at": string,"format_version": number,"google_sheet_id": number,"row_count": number,"starts_from": string | null,"starts_to": string | null,"tab_key": string,"title": string,"updated_at": string,"workspace_id": string,"year": number
                  }
                  Insert: {
                    "content_hash": string,"created_at"?: string,"format_version": number,"google_sheet_id": number,"row_count": number,"starts_from"?: string | null,"starts_to"?: string | null,"tab_key": string,"title": string,"updated_at"?: string,"workspace_id": string,"year": number
                  }
                  Update: {
                    "content_hash"?: string,"created_at"?: string,"format_version"?: number,"google_sheet_id"?: number,"row_count"?: number,"starts_from"?: string | null,"starts_to"?: string | null,"tab_key"?: string,"title"?: string,"updated_at"?: string,"workspace_id"?: string,"year"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "sheet_tabs_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "sheet_syncs"
      referencedColumns: ["workspace_id"]
    }
                  ]
                },"workspace_invites": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"created_at": string,"email": string,"expires_at": string,"id": string,"invited_by": string | null,"revoked_at": string | null,"role": Database["public"]['Enums']["workspace_role"],"token_hash": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"email": string,"expires_at": string,"id"?: string,"invited_by"?: string | null,"revoked_at"?: string | null,"role": Database["public"]['Enums']["workspace_role"],"token_hash": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"revoked_at"?: string | null,"role"?: Database["public"]['Enums']["workspace_role"],"token_hash"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_invites_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspace_roles": {
                  Row: {
                    "can_check_in": boolean,"created_at": string,"role": Database["public"]['Enums']["workspace_role"],"user_id": string,"workspace_id": string
                  }
                  Insert: {
                    "can_check_in"?: boolean,"created_at"?: string,"role": Database["public"]['Enums']["workspace_role"],"user_id": string,"workspace_id": string
                  }
                  Update: {
                    "can_check_in"?: boolean,"created_at"?: string,"role"?: Database["public"]['Enums']["workspace_role"],"user_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_roles_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspace_sending_suspensions": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"lifted_at": string | null,"lifted_by": string | null,"reason": Database["public"]['Enums']["suspension_reason"],"workspace_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"lifted_at"?: string | null,"lifted_by"?: string | null,"reason": Database["public"]['Enums']["suspension_reason"],"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"lifted_at"?: string | null,"lifted_by"?: string | null,"reason"?: Database["public"]['Enums']["suspension_reason"],"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_sending_suspensions_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspaces": {
                  Row: {
                    "created_at": string,"default_comments_enabled": boolean,"default_delay_options": (number)[],"default_duration_minutes": number,"default_footer_note": string,"default_meeting_url": string,"default_online_text": string,"default_reason_required": boolean,"default_reminder_going_hours": number | null,"default_reminder_pending_hours": number | null,"default_response_mode": Database["public"]['Enums']["response_mode"],"id": string,"locale": string,"name": string,"sender_connection_id": string | null,"slug": string,"timezone": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"default_comments_enabled"?: boolean,"default_delay_options"?: (number)[],"default_duration_minutes"?: number,"default_footer_note"?: string,"default_meeting_url"?: string,"default_online_text"?: string,"default_reason_required"?: boolean,"default_reminder_going_hours"?: number | null,"default_reminder_pending_hours"?: number | null,"default_response_mode"?: Database["public"]['Enums']["response_mode"],"id"?: string,"locale"?: string,"name": string,"sender_connection_id"?: string | null,"slug": string,"timezone": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"default_comments_enabled"?: boolean,"default_delay_options"?: (number)[],"default_duration_minutes"?: number,"default_footer_note"?: string,"default_meeting_url"?: string,"default_online_text"?: string,"default_reason_required"?: boolean,"default_reminder_going_hours"?: number | null,"default_reminder_pending_hours"?: number | null,"default_response_mode"?: Database["public"]['Enums']["response_mode"],"id"?: string,"locale"?: string,"name"?: string,"sender_connection_id"?: string | null,"slug"?: string,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspaces_sender_connection_id_fkey"
      columns: ["sender_connection_id"]
isOneToOne: false
      referencedRelation: "google_connections"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_admin_invite":
{ Args: { "p_token_hash": string }; Returns: undefined
                           },
"accept_invite":
{ Args: { "p_token_hash": string }; Returns: string
                           },
"add_meeting_people":
{ Args: { "p_meeting": string,"p_people": Json,"p_save_to_roster": boolean }; Returns: Json
                           },
"admin_admins":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_invite":
{ Args: { "p_email": string,"p_token_hash": string }; Returns: Json
                           },
"admin_invite_preview":
{ Args: { "p_token_hash": string }; Returns: {
              "masked_email": string,"status": string
            }[]
                           },
"admin_invite_renew":
{ Args: { "p_invite": string,"p_token_hash": string }; Returns: Json
                           },
"admin_invite_revoke":
{ Args: { "p_invite": string }; Returns: undefined
                           },
"admin_lift":
{ Args: { "p_workspace": string }; Returns: undefined
                           },
"admin_log":
{ Args: { "p_after_id": number,"p_filter": string,"p_limit": number }; Returns: Json
                           },
"admin_mark_reviewed":
{ Args: { "p_report": string }; Returns: undefined
                           },
"admin_overview":
{ Args: { "p_days": number }; Returns: Json
                           },
"admin_remove":
{ Args: { "p_user": string }; Returns: undefined
                           },
"admin_reports":
{ Args: { "p_after_at": string,"p_after_id": string,"p_limit": number }; Returns: Json
                           },
"admin_suspend":
{ Args: { "p_workspace": string }; Returns: undefined
                           },
"admin_workspace":
{ Args: { "p_workspace": string }; Returns: Json
                           },
"admin_workspaces":
{ Args: { "p_after_id": string,"p_after_value": string,"p_filter": string,"p_limit": number,"p_search": string,"p_sort": string }; Returns: Json
                           },
"attendance_details":
{ Args: { "p_after_invitee"?: string,"p_after_meeting"?: string,"p_after_name"?: string,"p_after_starts"?: string,"p_from"?: string,"p_limit"?: number,"p_to"?: string,"p_workspace": string }; Returns: Json
                           },
"attendance_summary":
{ Args: { "p_from"?: string,"p_to"?: string,"p_workspace": string }; Returns: Json
                           },
"bulk_contacts":
{ Args: { "p_action": string,"p_contact_ids": (string)[],"p_list_id"?: string,"p_workspace": string }; Returns: number
                           },
"cancel_meeting":
{ Args: { "p_meeting": string }; Returns: Json
                           },
"change_role":
{ Args: { "p_can_check_in": boolean,"p_role": Database["public"]['Enums']["workspace_role"],"p_user": string,"p_workspace": string }; Returns: undefined
                           },
"check_ip_rate_limit":
{ Args: { "p_action": string,"p_ip": string }; Returns: boolean
                           },
"check_token_rate_limit":
{ Args: { "p_ip": string,"p_token_hash": string }; Returns: boolean
                           },
"consume_admin_invite_email":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"consume_invite_email":
{ Args: { "p_workspace": string }; Returns: boolean
                           },
"contact_history":
{ Args: { "p_after_meeting"?: string,"p_after_starts"?: string,"p_contact": string,"p_from"?: string,"p_limit"?: number,"p_to"?: string }; Returns: Json
                           },
"create_invite":
{ Args: { "p_email": string,"p_role": Database["public"]['Enums']["workspace_role"],"p_token_hash": string,"p_workspace": string }; Returns: string
                           },
"create_meeting":
{ Args: { "p_workspace": string }; Returns: string
                           },
"create_workspace":
{ Args: { "p_name": string,"p_slug": string,"p_timezone": string }; Returns: {
              "created_at": string,
"default_comments_enabled": boolean,
"default_delay_options": (number)[],
"default_duration_minutes": number,
"default_footer_note": string,
"default_meeting_url": string,
"default_online_text": string,
"default_reason_required": boolean,
"default_reminder_going_hours": number | null,
"default_reminder_pending_hours": number | null,
"default_response_mode": Database["public"]['Enums']["response_mode"],
"id": string,
"locale": string,
"name": string,
"sender_connection_id": string | null,
"slug": string,
"timezone": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "workspaces"
        isOneToOne: true
        isSetofReturn: false
      } },
"delete_account":
{ Args: { "p_confirm": string }; Returns: Json
                           },
"delete_cancelled_meeting":
{ Args: { "p_meeting": string }; Returns: undefined
                           },
"delete_workspace":
{ Args: { "p_confirm_name": string,"p_workspace": string }; Returns: Json
                           },
"disconnect_google_connection":
{ Args: { "p_connection": string }; Returns: Json
                           },
"dispatch_claim":
{ Args: { "p_lease_seconds": number,"p_limit": number,"p_run": string }; Returns: Json
                           },
"dispatch_defer_sender":
{ Args: { "p_connection": string,"p_error": string,"p_run": string,"p_until": string }; Returns: undefined
                           },
"dispatch_finish":
{ Args: { "p_error": string,"p_job": string,"p_outcome": Database["public"]['Enums']["invitee_email_status"],"p_token_hash": string }; Returns: undefined
                           },
"dispatch_mark_broken":
{ Args: { "p_connection": string,"p_reason": string,"p_run": string }; Returns: Json
                           },
"dispatch_release":
{ Args: { "p_run": string }; Returns: undefined
                           },
"dispatch_reserve":
{ Args: { "p_job": string,"p_token_hash"?: string }; Returns: Json
                           },
"dispatch_retry":
{ Args: { "p_error": string,"p_job": string }; Returns: Json
                           },
"dispatch_set_thread":
{ Args: { "p_connection": string,"p_meeting": string,"p_root_message_id": string,"p_thread_id": string }; Returns: undefined
                           },
"dispatch_unclaim":
{ Args: { "p_jobs": (string)[] }; Returns: undefined
                           },
"duplicate_meeting":
{ Args: { "p_meeting": string }; Returns: string
                           },
"edit_sent_meeting":
{ Args: { "p_dry_run"?: boolean,"p_fields": Json,"p_meeting": string,"p_notify"?: boolean }; Returns: Json
                           },
"google_connection_saved":
{ Args: { "p_connection": string,"p_user": string }; Returns: undefined
                           },
"healthcheck":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"hit_google_connect_limit":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"import_contacts":
{ Args: { "p_also_add_to_list"?: string,"p_dry_run": boolean,"p_rows": Json,"p_workspace": string }; Returns: Json
                           },
"invite_preview":
{ Args: { "p_token_hash": string }; Returns: {
              "masked_email": string,"role": Database["public"]['Enums']["workspace_role"],"status": string,"workspace_name": string,"workspace_slug": string
            }[]
                           },
"invites_page":
{ Args: { "p_after_created"?: string,"p_after_id"?: string,"p_limit"?: number,"p_workspace": string }; Returns: Json
                           },
"keep_alive":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"leave_workspace":
{ Args: { "p_workspace": string }; Returns: undefined
                           },
"list_members":
{ Args: { "p_workspace": string }; Returns: {
              "avatar_url": string,"can_check_in": boolean,"display_name": string,"email": string,"joined_at": string,"role": Database["public"]['Enums']["workspace_role"],"user_id": string
            }[]
                           },
"mark_attendance":
{ Args: { "p_actual"?: Database["public"]['Enums']["attendance_actual"],"p_invitee": string,"p_late_minutes"?: number,"p_meeting": string }; Returns: Json
                           },
"mark_rest_as_declared":
{ Args: { "p_meeting": string }; Returns: number
                           },
"meeting_audience":
{ Args: { "p_meeting": string }; Returns: Json
                           },
"meeting_people":
{ Args: { "p_after_id"?: string,"p_after_name"?: string,"p_filter"?: string,"p_limit"?: number,"p_meeting": string,"p_search"?: string }; Returns: Json
                           },
"meeting_results":
{ Args: { "p_meeting": string }; Returns: Json
                           },
"meetings_page":
{ Args: { "p_after_id"?: string,"p_after_key"?: string,"p_limit"?: number,"p_tab": string,"p_workspace": string }; Returns: Json
                           },
"members_page":
{ Args: { "p_after_id"?: string,"p_after_name"?: string,"p_after_role"?: Database["public"]['Enums']["workspace_role"],"p_limit"?: number,"p_role"?: Database["public"]['Enums']["workspace_role"],"p_workspace": string }; Returns: Json
                           },
"my_account":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"my_answers":
{ Args: { "p_after_invitee": string,"p_after_starts": string,"p_limit": number }; Returns: Json
                           },
"my_invite":
{ Args: { "p_invitee": string }; Returns: string
                           },
"my_invites":
{ Args: { "p_after_invitee": string,"p_after_starts": string,"p_filter": string,"p_limit": number,"p_tab": string }; Returns: Json
                           },
"my_platform_role":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"nudge_meeting":
{ Args: { "p_meeting": string }; Returns: Json
                           },
"platform_event_done":
{ Args: { "p_event": number }; Returns: undefined
                           },
"platform_event_failed":
{ Args: { "p_event": number }; Returns: number
                           },
"platform_event_owner_target":
{ Args: { "p_event": number }; Returns: Json
                           },
"platform_events_claim":
{ Args: { "p_lease_seconds": number,"p_limit": number }; Returns: Json
                           },
"push_claim":
{ Args: { "p_lease_seconds": number,"p_limit": number,"p_run": string }; Returns: Json
                           },
"push_done":
{ Args: { "p_delivery": string,"p_run": string }; Returns: boolean
                           },
"push_drop":
{ Args: { "p_delivery": string,"p_run": string }; Returns: undefined
                           },
"push_gone":
{ Args: { "p_delivery": string,"p_run": string }; Returns: undefined
                           },
"push_retry":
{ Args: { "p_after_seconds": number,"p_delivery": string,"p_run": string }; Returns: boolean
                           },
"push_subscribe":
{ Args: { "p_auth": string,"p_endpoint": string,"p_p256dh": string }; Returns: undefined
                           },
"push_unsubscribe":
{ Args: { "p_endpoint": string }; Returns: undefined
                           },
"record_worker_failure":
{ Args: { "p_lane": string }; Returns: undefined
                           },
"remove_member":
{ Args: { "p_user": string,"p_workspace": string }; Returns: undefined
                           },
"renew_invite":
{ Args: { "p_invite": string,"p_token_hash": string }; Returns: undefined
                           },
"retry_sheet":
{ Args: { "p_workspace": string }; Returns: undefined
                           },
"revoke_invite":
{ Args: { "p_invite": string }; Returns: undefined
                           },
"roster":
{ Args: { "p_workspace": string }; Returns: Json
                           },
"save_google_connection":
{ Args: { "p_google_email": string,"p_google_sub": string,"p_scopes": (string)[],"p_token_encrypted": string,"p_user": string }; Returns: string
                           },
"send_meeting":
{ Args: { "p_meeting": string }; Returns: Json
                           },
"set_contact_lists":
{ Args: { "p_contact": string,"p_list_ids": (string)[] }; Returns: undefined
                           },
"set_meeting_audience":
{ Args: { "p_exclude": (string)[],"p_include": (string)[],"p_list_ids": (string)[],"p_meeting": string }; Returns: undefined
                           },
"set_workspace_sender":
{ Args: { "p_connection": string,"p_workspace": string }; Returns: undefined
                           },
"sheet_claim":
{ Args: { "p_lease_seconds": number,"p_limit": number,"p_run": string }; Returns: Json
                           },
"sheet_drop_tabs":
{ Args: { "p_keys": (string)[],"p_run": string,"p_workspace": string }; Returns: undefined
                           },
"sheet_finish_year":
{ Args: { "p_run": string,"p_version": number,"p_workspace": string,"p_year": number }; Returns: boolean
                           },
"sheet_pause":
{ Args: { "p_reason": Database["public"]['Enums']["sheet_pause_reason"],"p_run": string,"p_workspace": string }; Returns: Json
                           },
"sheet_release":
{ Args: { "p_run": string,"p_synced": boolean,"p_workspace": string }; Returns: undefined
                           },
"sheet_retry":
{ Args: { "p_error": string,"p_run": string,"p_workspace": string }; Returns: undefined
                           },
"sheet_rows":
{ Args: { "p_workspace": string,"p_year": number }; Returns: Json
                           },
"sheet_save_file":
{ Args: { "p_run": string,"p_spreadsheet_id": string,"p_workspace": string }; Returns: boolean
                           },
"sheet_save_tab":
{ Args: { "p_run": string,"p_tab": Json,"p_workspace": string }; Returns: boolean
                           },
"start_sheet":
{ Args: { "p_connection": string,"p_replace": boolean,"p_user": string,"p_workspace": string }; Returns: Json
                           },
"token_invitee":
{ Args: { "p_token_hash": string }; Returns: Json
                           },
"token_request_calendar":
{ Args: { "p_token_hash": string }; Returns: boolean
                           },
"token_resubscribe":
{ Args: { "p_token_hash": string }; Returns: boolean
                           },
"token_submit_response":
{ Args: { "p_comment"?: string,"p_delay_minutes"?: number,"p_reason"?: string,"p_seen_starts_at"?: string,"p_status": Database["public"]['Enums']["response_status"],"p_token_hash": string }; Returns: Json
                           },
"token_unsubscribe":
{ Args: { "p_token_hash": string,"p_via": Database["public"]['Enums']["unsubscribe_via"] }; Returns: boolean
                           },
"token_viewer":
{ Args: { "p_token_hash": string,"p_user": string }; Returns: string
                           },
"transfer_ownership":
{ Args: { "p_confirm_name": string,"p_new_owner": string,"p_workspace": string }; Returns: undefined
                           },
"turn_off_sheet":
{ Args: { "p_workspace": string }; Returns: Json
                           },
"update_contact":
{ Args: { "p_contact": string,"p_email": string,"p_full_name": string,"p_list_ids": (string)[],"p_workspace": string }; Returns: undefined
                           },
"workspace_sender":
{ Args: { "p_workspace": string }; Returns: Json
                           },
"workspace_sheet":
{ Args: { "p_workspace": string }; Returns: Json
                           }
          }
          Enums: {
            "attendance_actual": "present"|"late"|"absent","audience_mode": "include"|"exclude","calendar_state": "none"|"added","connection_status": "active"|"broken","invitee_email_status": "queued"|"sent"|"skipped"|"failed"|"unknown","job_kind": "invite"|"calendar_confirm"|"update"|"cancel"|"reminder","job_status": "pending"|"processing"|"done"|"failed"|"paused","location_mode": "in_person"|"online"|"hybrid","meeting_change_kind": "edit"|"cancel","meeting_status": "draft"|"scheduled"|"cancelled","platform_event_kind": "auto_suspended"|"suspended"|"lifted"|"report"|"report_reviewed"|"admin_invited"|"admin_joined"|"admin_removed"|"invite_revoked"|"owner_set"|"platform_email_cap"|"worker_failing","platform_role": "owner"|"admin","push_kind": "invite"|"update"|"cancel"|"reminder","response_mode": "announcement"|"rsvp"|"attendance","response_status": "attending"|"late"|"absent"|"not_attending","sheet_pause_reason": "trashed"|"deleted"|"access_lost"|"full"|"drive_full","sheet_status": "active"|"paused","suspension_reason": "auto_reports"|"platform_admin","unsubscribe_via": "link"|"report","workspace_role": "owner"|"admin"|"viewer"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "attendance_actual": ["present", "late", "absent"],"audience_mode": ["include", "exclude"],"calendar_state": ["none", "added"],"connection_status": ["active", "broken"],"invitee_email_status": ["queued", "sent", "skipped", "failed", "unknown"],"job_kind": ["invite", "calendar_confirm", "update", "cancel", "reminder"],"job_status": ["pending", "processing", "done", "failed", "paused"],"location_mode": ["in_person", "online", "hybrid"],"meeting_change_kind": ["edit", "cancel"],"meeting_status": ["draft", "scheduled", "cancelled"],"platform_event_kind": ["auto_suspended", "suspended", "lifted", "report", "report_reviewed", "admin_invited", "admin_joined", "admin_removed", "invite_revoked", "owner_set", "platform_email_cap", "worker_failing"],"platform_role": ["owner", "admin"],"push_kind": ["invite", "update", "cancel", "reminder"],"response_mode": ["announcement", "rsvp", "attendance"],"response_status": ["attending", "late", "absent", "not_attending"],"sheet_pause_reason": ["trashed", "deleted", "access_lost", "full", "drive_full"],"sheet_status": ["active", "paused"],"suspension_reason": ["auto_reports", "platform_admin"],"unsubscribe_via": ["link", "report"],"workspace_role": ["owner", "admin", "viewer"]
          }
        }
} as const
