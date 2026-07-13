// Auto-generated types matching the database schema in 001_initial_schema.sql

export type Role = 'superadmin' | 'owner' | 'admin' | 'staff' | 'artist'
export type ArtistStatus = 'pending_review' | 'approved' | 'rejected' | 'inactive' | 'flagged'
export type ArtistGender = 'male' | 'female' | 'other'
export type RequirementGender = 'male' | 'female' | 'any'
export type EnergyLevel = 'high' | 'medium' | 'low' | 'uncertain'
export type ArtistType = 'headliner' | 'konferansier' | 'klubbspot' | 'stand-up' | 'open mic'
export type ShowStatus = 'draft' | 'booking' | 'fullbooked' | 'published' | 'completed' | 'cancelled'
export type RequirementEnergy = 'high' | 'low' | 'any' | 'uncertain'
export type RequirementCompensationType = 'fixed' | 'percent'
export type RequirementBookingMode = 'auto' | 'manual'
export type BookingOfferStatus = 'sent' | 'accepted' | 'declined' | 'expired' | 'filled_by_other' | 'cancelled'
export type ConfirmedSpotStatus = 'confirmed' | 'cancelled' | 'completed' | 'paid'
export type OrderStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled'
export type TicketStatus = 'valid' | 'used' | 'refunded' | 'cancelled'
export type EmailLogStatus = 'pending' | 'sent' | 'failed'
export type MarketingTaskKey =
  | 'publish_event_page'
  | 'activate_ticket_sales'
  | 'upload_poster'
  | 'create_facebook_event'
  | 'share_facebook_groups'
  | 'send_calendar_partners'
  | 'schedule_email'
export type MarketingDesignKind = 'ai_reference' | 'frame_background'
export type MarketingDesignFileType = 'image'
export type PosterMode = 'framed' | 'ai_generated' | 'template'
export type PosterTemplateStatus = 'draft' | 'confirmed'

// ─────────────────────────────────────────────────────────────
// Row types
// ─────────────────────────────────────────────────────────────

export type Club = {
  id: string
  name: string
  slug: string
  description: string | null
  logo_url: string | null
  header_image_url: string | null
  gallery_image_urls: string[]
  location_name: string | null
  address_line: string | null
  city: string | null
  default_ai_poster_reference_url: string | null
  default_frame_background_url: string | null
  default_poster_template_id: string | null
  /** Cached PosterBrandKit jsonb derived from the club's default reference poster (see lib/poster-brand-kit.ts). */
  default_poster_brand_kit: unknown | null
  created_at: string
  updated_at: string
}

export type ClubMembership = {
  id: string
  club_id: string
  profile_id: string
  created_at: string
}

export type Profile = {
  id: string
  auth_user_id: string
  email: string
  full_name: string | null
  role: Role
  created_at: string
  updated_at: string
}

export type Artist = {
  id: string
  auth_user_id: string | null
  full_name: string
  stage_name: string | null
  email: string
  phone: string | null
  profile_image_url: string | null
  profile_image_urls: string[]
  bio: string | null
  category: ArtistType[] | null
  language: string | null
  social_links: Record<string, string> | null
  gender: ArtistGender | null
  status: ArtistStatus
  admin_score: number | null
  admin_energy_level: EnergyLevel | null
  admin_notes: string | null
  is_flagged: boolean
  flag_reason: string | null
  flagged_at: string | null
  created_at: string
  updated_at: string
}

export type ArtistAvailability = {
  id: string
  artist_id: string
  available_date: string
  created_at: string
}

export type Show = {
  id: string
  title: string
  slug: string
  description: string | null
  date: string
  start_time: string | null
  end_time: string | null
  venue_name: string | null
  venue_address: string | null
  capacity: number | null
  ticket_price: number | null
  currency: string
  ticket_url: string | null
  poster_url: string | null
  selected_marketing_design_id: string | null
  selected_ai_reference_id: string | null
  selected_frame_background_id: string | null
  selected_poster_template_id: string | null
  poster_mode: PosterMode
  poster_use_reference: boolean
  status: ShowStatus
  stripe_product_id: string | null
  stripe_price_id: string | null
  is_template: boolean
  published_at: string | null
  club_id: string | null
  created_at: string
  updated_at: string
}

export type ShowMarketingDesign = {
  id: string
  show_id: string
  label: string | null
  file_url: string
  file_path: string
  file_name: string
  mime_type: string
  file_type: MarketingDesignFileType
  file_size: number | null
  design_kind: MarketingDesignKind
  /** Cached PosterBrandKit jsonb derived from this reference (see lib/poster-brand-kit.ts). */
  brand_kit: unknown | null
  created_at: string
  updated_at: string
}

export type PosterTemplate = {
  id: string
  club_id: string
  name: string
  status: PosterTemplateStatus
  source_poster_path: string | null
  source_poster_url: string | null
  plate_path: string | null
  plate_url: string | null
  canvas_width: number
  canvas_height: number
  palette: unknown
  text_slots: unknown
  photo_frames: unknown
  logos: unknown
  created_by: string | null
  created_at: string
  updated_at: string
  confirmed_at: string | null
}

export type ShowRequirement = {
  id: string
  show_id: string
  role_name: string
  quantity: number
  lineup_position: number
  min_score: number | null
  energy_level: RequirementEnergy
  required_gender: RequirementGender
  booking_mode: RequirementBookingMode
  compensation_type: RequirementCompensationType | null
  compensation_amount: number | null
  compensation_percent: number | null
  created_at: string
  updated_at: string
}

export type BookingOffer = {
  id: string
  show_id: string
  artist_id: string
  show_requirement_id: string
  token: string
  status: BookingOfferStatus
  fee_amount: number | null
  currency: string
  sent_at: string | null
  responded_at: string | null
  expires_at: string | null
  created_at: string
  updated_at: string
}

export type ConfirmedSpot = {
  id: string
  show_id: string
  artist_id: string
  show_requirement_id: string
  booking_offer_id: string | null
  fee_amount: number | null
  currency: string
  status: ConfirmedSpotStatus
  confirmed_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
}

export type Customer = {
  id: string
  email: string
  name: string | null
  phone: string | null
  marketing_consent: boolean
  stripe_customer_id: string | null
  created_at: string
  updated_at: string
}

export type Order = {
  id: string
  show_id: string | null
  customer_id: string | null
  stripe_checkout_session_id: string | null
  stripe_payment_intent_id: string | null
  stripe_customer_id: string | null
  amount_total: number | null
  currency: string
  status: OrderStatus
  buyer_email: string | null
  buyer_name: string | null
  created_at: string
  updated_at: string
}

export type Ticket = {
  id: string
  show_id: string
  order_id: string
  customer_id: string | null
  ticket_code: string
  status: TicketStatus
  checked_in_at: string | null
  created_at: string
  updated_at: string
}

export type EmailLog = {
  id: string
  recipient_email: string
  subject: string | null
  template_name: string | null
  resend_email_id: string | null
  status: EmailLogStatus
  error_message: string | null
  payload: unknown | null
  created_at: string
  sent_at: string | null
}

export type MarketingTask = {
  id: string
  show_id: string
  task_key: MarketingTaskKey | null
  label: string | null
  is_completed: boolean
  created_at: string
  updated_at: string
}

export type BookingScoringConfig = {
  id: string
  quality_weight: number
  availability_bonus: number
  role_match_bonus: number
  busy_penalty_per_booking: number
  busy_window_days: number
  offers_per_slot: number
  fallback_limit: number
  updated_at: string
}

export type ClubBookingSettingsRow = {
  club_id: string
  fairness_window_months: number
  fairness_multiplier_0: number
  fairness_multiplier_1: number
  fairness_multiplier_2: number
  fairness_multiplier_3: number
  fairness_multiplier_4_plus: number
  consecutive_event_multiplier: number
  quality_weight: number
  availability_bonus: number
  role_match_bonus: number
  offers_per_slot: number
  offers_per_wave: number
  fallback_limit: number
  min_bookable_score: number
  updated_at: string
}

export type ShowArtistBookingExclusion = {
  id: string
  show_id: string
  artist_id: string
  reason: string | null
  created_at: string
}

export type ArtistClubScore = {
  id: string
  artist_id: string
  club_id: string
  approved: boolean
  score: number | null
  /** Per-club nivå/segments (Headliner, Konferansier, Klubbspot, Stand-up, Open Mic). Overrides the artist's self-declared category for this club's booking. */
  categories: string[] | null
  notes: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export type ArtistPerformanceReview = {
  id: string
  confirmed_spot_id: string
  artist_id: string
  show_id: string
  club_id: string | null
  score: number
  notes: string | null
  created_at: string
  updated_at: string
}

// ─────────────────────────────────────────────────────────────
// Supabase Database generic type (supabase-js v2 format)
// Fields with DB defaults are optional in Insert, all optional in Update.
// ─────────────────────────────────────────────────────────────
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: {
          id?: string
          auth_user_id: string
          email: string
          full_name?: string | null
          role?: Role
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Profile>
        Relationships: []
      }
      artists: {
        Row: Artist
        Insert: {
          id?: string
          auth_user_id?: string | null
          full_name: string
          stage_name?: string | null
          email: string
          phone?: string | null
          profile_image_url?: string | null
          profile_image_urls?: string[]
          bio?: string | null
          category?: ArtistType[] | null
          language?: string | null
          gender?: ArtistGender | null
          social_links?: Record<string, string> | null
          status?: ArtistStatus
          admin_score?: number | null
          admin_energy_level?: EnergyLevel | null
          admin_notes?: string | null
          is_flagged?: boolean
          flag_reason?: string | null
          flagged_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Artist>
        Relationships: []
      }
      artist_availability: {
        Row: ArtistAvailability
        Insert: {
          id?: string
          artist_id: string
          available_date: string
          created_at?: string
        }
        Update: Partial<ArtistAvailability>
        Relationships: []
      }
      shows: {
        Row: Show
        Insert: {
          id?: string
          title: string
          slug: string
          description?: string | null
          date: string
          start_time?: string | null
          end_time?: string | null
          venue_name?: string | null
          venue_address?: string | null
          capacity?: number | null
          ticket_price?: number | null
          currency?: string
          ticket_url?: string | null
          poster_url?: string | null
          selected_marketing_design_id?: string | null
          selected_ai_reference_id?: string | null
          selected_frame_background_id?: string | null
          selected_poster_template_id?: string | null
          poster_mode?: PosterMode
          poster_use_reference?: boolean
          status?: ShowStatus
          stripe_product_id?: string | null
          stripe_price_id?: string | null
          is_template?: boolean
          published_at?: string | null
          club_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Show>
        Relationships: []
      }
      show_marketing_designs: {
        Row: ShowMarketingDesign
        Insert: {
          id?: string
          show_id: string
          label?: string | null
          file_url: string
          file_path: string
          file_name: string
          mime_type: string
          file_type: MarketingDesignFileType
          file_size?: number | null
          design_kind?: MarketingDesignKind
          brand_kit?: unknown | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<ShowMarketingDesign>
        Relationships: []
      }
      show_requirements: {
        Row: ShowRequirement
        Insert: {
          id?: string
          show_id: string
          role_name: string
          quantity: number
          lineup_position?: number
          min_score?: number | null
          energy_level?: RequirementEnergy
          required_gender?: RequirementGender
          booking_mode?: RequirementBookingMode
          compensation_type?: RequirementCompensationType | null
          compensation_amount?: number | null
          compensation_percent?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<ShowRequirement>
        Relationships: []
      }
      booking_offers: {
        Row: BookingOffer
        Insert: {
          id?: string
          show_id: string
          artist_id: string
          show_requirement_id: string
          token?: string
          status?: BookingOfferStatus
          fee_amount?: number | null
          currency?: string
          sent_at?: string | null
          responded_at?: string | null
          expires_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<BookingOffer>
        Relationships: []
      }
      confirmed_spots: {
        Row: ConfirmedSpot
        Insert: {
          id?: string
          show_id: string
          artist_id: string
          show_requirement_id: string
          booking_offer_id?: string | null
          fee_amount?: number | null
          currency?: string
          status?: ConfirmedSpotStatus
          confirmed_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<ConfirmedSpot>
        Relationships: []
      }
      customers: {
        Row: Customer
        Insert: {
          id?: string
          email: string
          name?: string | null
          phone?: string | null
          marketing_consent?: boolean
          stripe_customer_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Customer>
        Relationships: []
      }
      orders: {
        Row: Order
        Insert: {
          id?: string
          show_id?: string | null
          customer_id?: string | null
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_customer_id?: string | null
          amount_total?: number | null
          currency?: string
          status?: OrderStatus
          buyer_email?: string | null
          buyer_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Order>
        Relationships: []
      }
      tickets: {
        Row: Ticket
        Insert: {
          id?: string
          show_id: string
          order_id: string
          customer_id?: string | null
          ticket_code?: string
          status?: TicketStatus
          checked_in_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Ticket>
        Relationships: []
      }
      email_logs: {
        Row: EmailLog
        Insert: {
          id?: string
          recipient_email: string
          subject?: string | null
          template_name?: string | null
          resend_email_id?: string | null
          status?: EmailLogStatus
          error_message?: string | null
          payload?: unknown | null
          created_at?: string
          sent_at?: string | null
        }
        Update: Partial<EmailLog>
        Relationships: []
      }
      marketing_tasks: {
        Row: MarketingTask
        Insert: {
          id?: string
          show_id: string
          task_key?: MarketingTaskKey | null
          label?: string | null
          is_completed?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: Partial<MarketingTask>
        Relationships: []
      }
      booking_scoring_config: {
        Row: BookingScoringConfig
        Insert: {
          id?: string
          quality_weight?: number
          availability_bonus?: number
          role_match_bonus?: number
          busy_penalty_per_booking?: number
          busy_window_days?: number
          offers_per_slot?: number
          fallback_limit?: number
          updated_at?: string
        }
        Update: Partial<Omit<BookingScoringConfig, 'id'>>
        Relationships: []
      }
      club_booking_settings: {
        Row: ClubBookingSettingsRow
        Insert: {
          club_id: string
          fairness_window_months?: number
          fairness_multiplier_0?: number
          fairness_multiplier_1?: number
          fairness_multiplier_2?: number
          fairness_multiplier_3?: number
          fairness_multiplier_4_plus?: number
          consecutive_event_multiplier?: number
          quality_weight?: number
          availability_bonus?: number
          role_match_bonus?: number
          offers_per_slot?: number
          offers_per_wave?: number
          fallback_limit?: number
          min_bookable_score?: number
          updated_at?: string
        }
        Update: Partial<Omit<ClubBookingSettingsRow, 'club_id'>>
        Relationships: []
      }
      show_artist_booking_exclusions: {
        Row: ShowArtistBookingExclusion
        Insert: {
          id?: string
          show_id: string
          artist_id: string
          reason?: string | null
          created_at?: string
        }
        Update: Partial<ShowArtistBookingExclusion>
        Relationships: []
      }
      clubs: {
        Row: Club
        Insert: {
          id?: string
          name: string
          slug: string
          description?: string | null
          logo_url?: string | null
          header_image_url?: string | null
          gallery_image_urls?: string[]
          location_name?: string | null
          address_line?: string | null
          city?: string | null
          default_ai_poster_reference_url?: string | null
          default_frame_background_url?: string | null
          default_poster_template_id?: string | null
          default_poster_brand_kit?: unknown | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Club>
        Relationships: []
      }
      poster_templates: {
        Row: PosterTemplate
        Insert: {
          id?: string
          club_id: string
          name?: string
          status?: PosterTemplateStatus
          source_poster_path?: string | null
          source_poster_url?: string | null
          plate_path?: string | null
          plate_url?: string | null
          canvas_width?: number
          canvas_height?: number
          palette?: unknown
          text_slots?: unknown
          photo_frames?: unknown
          logos?: unknown
          created_by?: string | null
          created_at?: string
          updated_at?: string
          confirmed_at?: string | null
        }
        Update: Partial<PosterTemplate>
        Relationships: []
      }
      club_memberships: {
        Row: ClubMembership
        Insert: {
          id?: string
          club_id: string
          profile_id: string
          created_at?: string
        }
        Update: Partial<ClubMembership>
        Relationships: []
      }
      artist_club_scores: {
        Row: ArtistClubScore
        Insert: {
          id?: string
          artist_id: string
          club_id: string
          approved?: boolean
          score?: number | null
          categories?: string[] | null
          notes?: string | null
          reviewed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<ArtistClubScore, 'id' | 'artist_id' | 'club_id' | 'created_at'>>
        Relationships: []
      }
      artist_performance_reviews: {
        Row: ArtistPerformanceReview
        Insert: {
          id?: string
          confirmed_spot_id: string
          artist_id: string
          show_id: string
          club_id?: string | null
          score: number
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<ArtistPerformanceReview, 'id' | 'confirmed_spot_id' | 'artist_id' | 'show_id' | 'created_at'>>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      accept_booking_offer: {
        Args: { p_token: string }
        Returns: {
          result: 'accepted' | 'filled_by_other' | 'already_booked' | 'declined' | 'expired' | 'cancelled'
          offer_id: string
          show_id: string
          artist_id: string
          show_requirement_id: string
          confirmed_spot_id: string | null
          should_notify: boolean
        }[]
      }
      complete_checkout_order: {
        Args: {
          p_show_id: string
          p_session_id: string
          p_payment_intent_id?: string | null
          p_stripe_customer_id?: string | null
          p_amount_total?: number | null
          p_currency?: string | null
          p_buyer_email?: string | null
          p_buyer_name?: string | null
        }
        Returns: {
          result: 'created' | 'duplicate' | 'sold_out' | 'invalid_show'
          order_id: string
          ticket_code: string | null
          duplicate: boolean
        }[]
      }
      insert_sent_offer_if_capacity: {
        Args: {
          p_show_id: string
          p_artist_id: string
          p_requirement_id: string
          p_offers_per_wave: number
          p_expires_at: string
          p_fee_amount?: number | null
          p_currency?: string | null
        }
        Returns: {
          token: string | null
          inserted: boolean
        }[]
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
