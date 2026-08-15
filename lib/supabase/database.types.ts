export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      allowed_emails: {
        Row: {
          added_at: string
          email: string
          note: string | null
        }
        Insert: {
          added_at?: string
          email: string
          note?: string | null
        }
        Update: {
          added_at?: string
          email?: string
          note?: string | null
        }
        Relationships: []
      }
      barcode_cache: {
        Row: {
          authors: string | null
          barcode: string
          cover_checked_at: string | null
          cover_url: string | null
          created_by: string | null
          issue_number: string | null
          page_count: number | null
          publisher: string | null
          resolved_at: string
          series_name: string | null
          source: Database["public"]["Enums"]["metadata_source"]
          source_id: string | null
          title: string | null
        }
        Insert: {
          authors?: string | null
          barcode: string
          cover_checked_at?: string | null
          cover_url?: string | null
          created_by?: string | null
          issue_number?: string | null
          page_count?: number | null
          publisher?: string | null
          resolved_at?: string
          series_name?: string | null
          source: Database["public"]["Enums"]["metadata_source"]
          source_id?: string | null
          title?: string | null
        }
        Update: {
          authors?: string | null
          barcode?: string
          cover_checked_at?: string | null
          cover_url?: string | null
          created_by?: string | null
          issue_number?: string | null
          page_count?: number | null
          publisher?: string | null
          resolved_at?: string
          series_name?: string | null
          source?: Database["public"]["Enums"]["metadata_source"]
          source_id?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "barcode_cache_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      barcode_misses: {
        Row: {
          barcode: string
          cover_url: string | null
          last_checked_at: string
        }
        Insert: {
          barcode: string
          cover_url?: string | null
          last_checked_at?: string
        }
        Update: {
          barcode?: string
          cover_url?: string | null
          last_checked_at?: string
        }
        Relationships: []
      }
      books: {
        Row: {
          authors: string | null
          barcode_prefix: string | null
          barcode_raw: string | null
          barcode_type: Database["public"]["Enums"]["barcode_type"] | null
          category: Database["public"]["Enums"]["book_category"]
          cover_repair_attempted_at: string | null
          cover_url: string | null
          created_at: string
          deleted_at: string | null
          id: string
          isbn: string | null
          issue_number: string | null
          metadata_source: Database["public"]["Enums"]["metadata_source"]
          metadata_source_id: string | null
          page_count: number | null
          publisher: string | null
          series_name: string | null
          title: string
          user_id: string
        }
        Insert: {
          authors?: string | null
          barcode_prefix?: string | null
          barcode_raw?: string | null
          barcode_type?: Database["public"]["Enums"]["barcode_type"] | null
          category: Database["public"]["Enums"]["book_category"]
          cover_repair_attempted_at?: string | null
          cover_url?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          isbn?: string | null
          issue_number?: string | null
          metadata_source?: Database["public"]["Enums"]["metadata_source"]
          metadata_source_id?: string | null
          page_count?: number | null
          publisher?: string | null
          series_name?: string | null
          title: string
          user_id: string
        }
        Update: {
          authors?: string | null
          barcode_prefix?: string | null
          barcode_raw?: string | null
          barcode_type?: Database["public"]["Enums"]["barcode_type"] | null
          category?: Database["public"]["Enums"]["book_category"]
          cover_repair_attempted_at?: string | null
          cover_url?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          isbn?: string | null
          issue_number?: string | null
          metadata_source?: Database["public"]["Enums"]["metadata_source"]
          metadata_source_id?: string | null
          page_count?: number | null
          publisher?: string | null
          series_name?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "books_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gcd_issues: {
        Row: {
          barcode: string | null
          barcode_prefix: string | null
          gcd_id: number
          id: number
          isbn: string | null
          key_date: string | null
          number: string | null
          page_count: number | null
          series_id: number | null
          title: string | null
        }
        Insert: {
          barcode?: string | null
          barcode_prefix?: string | null
          gcd_id: number
          id?: never
          isbn?: string | null
          key_date?: string | null
          number?: string | null
          page_count?: number | null
          series_id?: number | null
          title?: string | null
        }
        Update: {
          barcode?: string | null
          barcode_prefix?: string | null
          gcd_id?: number
          id?: never
          isbn?: string | null
          key_date?: string | null
          number?: string | null
          page_count?: number | null
          series_id?: number | null
          title?: string | null
        }
        Relationships: []
      }
      gcd_series: {
        Row: {
          format: string | null
          id: number
          language_id: number | null
          name: string | null
          publisher: string | null
          year_began: number | null
        }
        Insert: {
          format?: string | null
          id: number
          language_id?: number | null
          name?: string | null
          publisher?: string | null
          year_began?: number | null
        }
        Update: {
          format?: string | null
          id?: number
          language_id?: number | null
          name?: string | null
          publisher?: string | null
          year_began?: number | null
        }
        Relationships: []
      }
      global_action_quotas: {
        Row: {
          action_count: number
          kind: string
          window_started_at: string
        }
        Insert: {
          action_count: number
          kind: string
          window_started_at: string
        }
        Update: {
          action_count?: number
          kind?: string
          window_started_at?: string
        }
        Relationships: []
      }
      lookup_rate_limits: {
        Row: {
          kind: string
          lookup_count: number
          user_id: string
          window_started_at: string
        }
        Insert: {
          kind?: string
          lookup_count: number
          user_id: string
          window_started_at: string
        }
        Update: {
          kind?: string
          lookup_count?: number
          user_id?: string
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lookup_rate_limits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_objectives: {
        Row: {
          created_at: string
          id: string
          month: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          month: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          month?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_objectives_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_picks: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["pick_kind"]
          month: string
          reading_id: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["pick_kind"]
          month: string
          reading_id: string
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["pick_kind"]
          month?: string
          reading_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_picks_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_picks_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "readings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_picks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_reports: {
        Row: {
          computed_at: string
          fact_version: number
          month: string
          report: Json
          user_id: string
        }
        Insert: {
          computed_at?: string
          fact_version: number
          month: string
          report: Json
          user_id: string
        }
        Update: {
          computed_at?: string
          fact_version?: number
          month?: string
          report?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      objective_targets: {
        Row: {
          category: Database["public"]["Enums"]["book_category"]
          id: string
          objective_id: string
          target_count: number
        }
        Insert: {
          category: Database["public"]["Enums"]["book_category"]
          id?: string
          objective_id: string
          target_count: number
        }
        Update: {
          category?: Database["public"]["Enums"]["book_category"]
          id?: string
          objective_id?: string
          target_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "objective_targets_objective_id_fkey"
            columns: ["objective_id"]
            isOneToOne: false
            referencedRelation: "monthly_objectives"
            referencedColumns: ["id"]
          },
        ]
      }
      ownerships: {
        Row: {
          book_id: string
          created_at: string
          deleted_at: string | null
          disposed_at: string | null
          id: string
          owned_since: string | null
          user_id: string
        }
        Insert: {
          book_id: string
          created_at?: string
          deleted_at?: string | null
          disposed_at?: string | null
          id?: string
          owned_since?: string | null
          user_id: string
        }
        Update: {
          book_id?: string
          created_at?: string
          deleted_at?: string | null
          disposed_at?: string | null
          id?: string
          owned_since?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ownerships_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ownerships_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["book_id"]
          },
          {
            foreignKeyName: "ownerships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
        }
        Relationships: []
      }
      purchases: {
        Row: {
          book_id: string
          created_at: string
          deleted_at: string | null
          id: string
          purchased_at: string
          user_id: string
        }
        Insert: {
          book_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          purchased_at: string
          user_id: string
        }
        Update: {
          book_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          purchased_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["book_id"]
          },
          {
            foreignKeyName: "purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reading_events: {
        Row: {
          id: number
          occurred_at: string | null
          reading_id: string
          status: Database["public"]["Enums"]["reading_status"]
          user_id: string
        }
        Insert: {
          id?: never
          occurred_at?: string | null
          reading_id: string
          status: Database["public"]["Enums"]["reading_status"]
          user_id: string
        }
        Update: {
          id?: never
          occurred_at?: string | null
          reading_id?: string
          status?: Database["public"]["Enums"]["reading_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reading_events_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_events_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "readings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reading_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      readings: {
        Row: {
          book_id: string
          comment: string | null
          created_at: string
          deleted_at: string | null
          finished_at: string | null
          id: string
          rating: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["reading_status"]
          user_id: string
        }
        Insert: {
          book_id: string
          comment?: string | null
          created_at?: string
          deleted_at?: string | null
          finished_at?: string | null
          id?: string
          rating?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["reading_status"]
          user_id: string
        }
        Update: {
          book_id?: string
          comment?: string | null
          created_at?: string
          deleted_at?: string | null
          finished_at?: string | null
          id?: string
          rating?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["reading_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "readings_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "readings_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["book_id"]
          },
          {
            foreignKeyName: "readings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_inbox: {
        Row: {
          barcode_raw: string | null
          barcode_type: string | null
          completed_at: string | null
          cover_url: string | null
          created_at: string
          deleted_at: string | null
          finished_at: string | null
          id: string
          intent: Database["public"]["Enums"]["scan_intent"]
          owned_since: string | null
          resolved_metadata: Json | null
          status: Database["public"]["Enums"]["scan_inbox_status"]
          user_id: string
        }
        Insert: {
          barcode_raw?: string | null
          barcode_type?: string | null
          completed_at?: string | null
          cover_url?: string | null
          created_at?: string
          deleted_at?: string | null
          finished_at?: string | null
          id?: string
          intent: Database["public"]["Enums"]["scan_intent"]
          owned_since?: string | null
          resolved_metadata?: Json | null
          status?: Database["public"]["Enums"]["scan_inbox_status"]
          user_id: string
        }
        Update: {
          barcode_raw?: string | null
          barcode_type?: string | null
          completed_at?: string | null
          cover_url?: string | null
          created_at?: string
          deleted_at?: string | null
          finished_at?: string | null
          id?: string
          intent?: Database["public"]["Enums"]["scan_intent"]
          owned_since?: string | null
          resolved_metadata?: Json | null
          status?: Database["public"]["Enums"]["scan_inbox_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scan_inbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_fact_versions: {
        Row: {
          user_id: string
          version: number
        }
        Insert: {
          user_id: string
          version?: number
        }
        Update: {
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_fact_versions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      journal_entries: {
        Row: {
          book_id: string | null
          category: Database["public"]["Enums"]["book_category"] | null
          comment: string | null
          cover_url: string | null
          created_at: string | null
          finished_at: string | null
          id: string | null
          issue_number: string | null
          journal_date: string | null
          journal_month: string | null
          journal_rank: number | null
          page_count: number | null
          rating: number | null
          search_text: string | null
          series_name: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["reading_status"] | null
          title: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "readings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      consume_action_quota: { Args: { action_kind: string }; Returns: boolean }
      consume_global_quota: { Args: { action_kind: string }; Returns: boolean }
      merge_books: {
        Args: { keep_book_id: string; merge_book_id: string }
        Returns: undefined
      }
    }
    Enums: {
      barcode_type: "isbn" | "upc"
      book_category: "issue" | "manga" | "bd" | "comics" | "omnibus" | "roman"
      metadata_source: "gcd" | "bnf" | "google_books" | "metron" | "manual"
      pick_kind: "favorite" | "good_surprise" | "bad_surprise"
      reading_status: "reading" | "finished" | "abandoned"
      scan_inbox_status: "pending" | "completed"
      scan_intent: "own" | "own_read" | "read" | "purchase"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      barcode_type: ["isbn", "upc"],
      book_category: ["issue", "manga", "bd", "comics", "omnibus", "roman"],
      metadata_source: ["gcd", "bnf", "google_books", "metron", "manual"],
      pick_kind: ["favorite", "good_surprise", "bad_surprise"],
      reading_status: ["reading", "finished", "abandoned"],
      scan_inbox_status: ["pending", "completed"],
      scan_intent: ["own", "own_read", "read", "purchase"],
    },
  },
} as const
