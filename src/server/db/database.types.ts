
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "contacts": {
                  Row: {
                    "created_at": string,"email": string,"full_name": string,"id": string,"is_adhoc": boolean,"unsubscribed_at": string | null,"unsubscribed_via": Database["public"]['Enums']["unsubscribe_via"] | null,"updated_at": string,"user_id": string | null,"workspace_id": string
                  }
                  Insert: {
                    "created_at"?: string,"email": string,"full_name": string,"id"?: string,"is_adhoc"?: boolean,"unsubscribed_at"?: string | null,"unsubscribed_via"?: Database["public"]['Enums']["unsubscribe_via"] | null,"updated_at"?: string,"user_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"full_name"?: string,"id"?: string,"is_adhoc"?: boolean,"unsubscribed_at"?: string | null,"unsubscribed_via"?: Database["public"]['Enums']["unsubscribe_via"] | null,"updated_at"?: string,"user_id"?: string | null,"workspace_id"?: string
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
                },"meeting_invitees": {
                  Row: {
                    "contact_id": string,"email_error": string | null,"email_status": Database["public"]['Enums']["invitee_email_status"],"id": string,"invited_at": string,"meeting_id": string,"sent_at": string | null,"token_hash": string | null,"workspace_id": string
                  }
                  Insert: {
                    "contact_id": string,"email_error"?: string | null,"email_status"?: Database["public"]['Enums']["invitee_email_status"],"id"?: string,"invited_at"?: string,"meeting_id": string,"sent_at"?: string | null,"token_hash"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "contact_id"?: string,"email_error"?: string | null,"email_status"?: Database["public"]['Enums']["invitee_email_status"],"id"?: string,"invited_at"?: string,"meeting_id"?: string,"sent_at"?: string | null,"token_hash"?: string | null,"workspace_id"?: string
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
                    "agenda_md": string,"comments_enabled": boolean,"created_at": string,"created_by": string | null,"delay_options": (number)[],"duration_minutes": number,"footer_note": string,"gmail_root_message_id": string | null,"gmail_thread_id": string | null,"ics_sequence": number,"ics_uid": string,"id": string,"location_mode": Database["public"]['Enums']["location_mode"],"location_text": string,"meeting_url": string,"reason_required": boolean,"response_deadline": string | null,"response_mode": Database["public"]['Enums']["response_mode"],"sent_at": string | null,"starts_at": string | null,"status": Database["public"]['Enums']["meeting_status"],"thread_connection_id": string | null,"timezone": string,"title": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "agenda_md"?: string,"comments_enabled": boolean,"created_at"?: string,"created_by"?: string | null,"delay_options"?: (number)[],"duration_minutes": number,"footer_note"?: string,"gmail_root_message_id"?: string | null,"gmail_thread_id"?: string | null,"ics_sequence"?: number,"ics_uid"?: string,"id"?: string,"location_mode"?: Database["public"]['Enums']["location_mode"],"location_text"?: string,"meeting_url"?: string,"reason_required": boolean,"response_deadline"?: string | null,"response_mode": Database["public"]['Enums']["response_mode"],"sent_at"?: string | null,"starts_at"?: string | null,"status"?: Database["public"]['Enums']["meeting_status"],"thread_connection_id"?: string | null,"timezone": string,"title"?: string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "agenda_md"?: string,"comments_enabled"?: boolean,"created_at"?: string,"created_by"?: string | null,"delay_options"?: (number)[],"duration_minutes"?: number,"footer_note"?: string,"gmail_root_message_id"?: string | null,"gmail_thread_id"?: string | null,"ics_sequence"?: number,"ics_uid"?: string,"id"?: string,"location_mode"?: Database["public"]['Enums']["location_mode"],"location_text"?: string,"meeting_url"?: string,"reason_required"?: boolean,"response_deadline"?: string | null,"response_mode"?: Database["public"]['Enums']["response_mode"],"sent_at"?: string | null,"starts_at"?: string | null,"status"?: Database["public"]['Enums']["meeting_status"],"thread_connection_id"?: string | null,"timezone"?: string,"title"?: string,"updated_at"?: string,"workspace_id"?: string
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
      foreignKeyName: "send_log_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
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
                },"workspaces": {
                  Row: {
                    "created_at": string,"default_comments_enabled": boolean,"default_delay_options": (number)[],"default_duration_minutes": number,"default_footer_note": string,"default_reason_required": boolean,"default_response_mode": Database["public"]['Enums']["response_mode"],"id": string,"locale": string,"name": string,"sender_connection_id": string | null,"slug": string,"timezone": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"default_comments_enabled"?: boolean,"default_delay_options"?: (number)[],"default_duration_minutes"?: number,"default_footer_note"?: string,"default_reason_required"?: boolean,"default_response_mode"?: Database["public"]['Enums']["response_mode"],"id"?: string,"locale"?: string,"name": string,"sender_connection_id"?: string | null,"slug": string,"timezone": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"default_comments_enabled"?: boolean,"default_delay_options"?: (number)[],"default_duration_minutes"?: number,"default_footer_note"?: string,"default_reason_required"?: boolean,"default_response_mode"?: Database["public"]['Enums']["response_mode"],"id"?: string,"locale"?: string,"name"?: string,"sender_connection_id"?: string | null,"slug"?: string,"timezone"?: string,"updated_at"?: string
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
            "accept_invite":
{ Args: { "p_token_hash": string }; Returns: string
                           },
"add_meeting_people":
{ Args: { "p_meeting": string,"p_people": Json,"p_save_to_roster": boolean }; Returns: Json
                           },
"bulk_contacts":
{ Args: { "p_action": string,"p_contact_ids": (string)[],"p_list_id"?: string,"p_workspace": string }; Returns: number
                           },
"change_role":
{ Args: { "p_can_check_in": boolean,"p_role": Database["public"]['Enums']["workspace_role"],"p_user": string,"p_workspace": string }; Returns: undefined
                           },
"check_ip_rate_limit":
{ Args: { "p_action": string,"p_ip": string }; Returns: boolean
                           },
"consume_invite_email":
{ Args: { "p_workspace": string }; Returns: boolean
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
"default_reason_required": boolean,
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
"delete_workspace":
{ Args: { "p_confirm_name": string,"p_workspace": string }; Returns: undefined
                           },
"disconnect_google_connection":
{ Args: { "p_connection": string }; Returns: Json
                           },
"healthcheck":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"import_contacts":
{ Args: { "p_also_add_to_list"?: string,"p_dry_run": boolean,"p_rows": Json,"p_workspace": string }; Returns: Json
                           },
"invite_preview":
{ Args: { "p_token_hash": string }; Returns: {
              "masked_email": string,"role": Database["public"]['Enums']["workspace_role"],"status": string,"workspace_name": string,"workspace_slug": string
            }[]
                           },
"leave_workspace":
{ Args: { "p_workspace": string }; Returns: undefined
                           },
"list_meetings":
{ Args: { "p_workspace": string }; Returns: Json
                           },
"list_members":
{ Args: { "p_workspace": string }; Returns: {
              "avatar_url": string,"can_check_in": boolean,"display_name": string,"email": string,"joined_at": string,"role": Database["public"]['Enums']["workspace_role"],"user_id": string
            }[]
                           },
"meeting_audience":
{ Args: { "p_meeting": string }; Returns: Json
                           },
"remove_member":
{ Args: { "p_user": string,"p_workspace": string }; Returns: undefined
                           },
"renew_invite":
{ Args: { "p_invite": string,"p_token_hash": string }; Returns: undefined
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
"set_contact_lists":
{ Args: { "p_contact": string,"p_list_ids": (string)[] }; Returns: undefined
                           },
"set_meeting_audience":
{ Args: { "p_exclude": (string)[],"p_include": (string)[],"p_list_ids": (string)[],"p_meeting": string }; Returns: undefined
                           },
"set_workspace_sender":
{ Args: { "p_connection": string,"p_workspace": string }; Returns: undefined
                           },
"transfer_ownership":
{ Args: { "p_confirm_name": string,"p_new_owner": string,"p_workspace": string }; Returns: undefined
                           },
"workspace_sender":
{ Args: { "p_workspace": string }; Returns: Json
                           }
          }
          Enums: {
            "audience_mode": "include"|"exclude","connection_status": "active"|"broken","invitee_email_status": "queued"|"sent"|"skipped"|"failed"|"unknown","location_mode": "in_person"|"online"|"hybrid","meeting_status": "draft"|"scheduled"|"cancelled","response_mode": "announcement"|"rsvp"|"attendance","unsubscribe_via": "link"|"report","workspace_role": "owner"|"admin"|"viewer"
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
            "audience_mode": ["include", "exclude"],"connection_status": ["active", "broken"],"invitee_email_status": ["queued", "sent", "skipped", "failed", "unknown"],"location_mode": ["in_person", "online", "hybrid"],"meeting_status": ["draft", "scheduled", "cancelled"],"response_mode": ["announcement", "rsvp", "attendance"],"unsubscribe_via": ["link", "report"],"workspace_role": ["owner", "admin", "viewer"]
          }
        }
} as const
