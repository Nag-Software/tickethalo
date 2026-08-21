// Auto-generated types matching the database schema in 001_initial_schema.sql

export type Role = 'superadmin' | 'owner' | 'admin' | 'staff' | 'artist'
export type ArtistStatus = 'pending_review' | 'approved' | 'rejected' | 'inactive' | 'flagged'
export type ArtistGender = 'male' | 'female'
export type RequirementGender = 'male' | 'female' | 'any'
export type EnergyLevel = 'high' | 'medium' | 'low' | 'uncertain'
export type ArtistType = 'headliner' | 'konferansier' | 'stand-up' | 'open mic'
export type ShowStatus = 'draft' | 'booking' | 'fullbooked' | 'published' | 'completed' | 'cancelled'
export type RequirementEnergy = 'high' | 'low' | 'any' | 'uncertain'
export type RequirementCompensationType = 'fixed' | 'percent'
export type BookingOfferStatus = 'sent' | 'accepted' | 'declined' | 'expired' | 'filled_by_other' | 'cancelled'
export type ConfirmedSpotStatus = 'confirmed' | 'cancelled' | 'completed' | 'paid'
export type OrderStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled'
export type TicketStatus = 'valid' | 'used' | 'refunded' | 'cancelled'
export type ClubPayoutStatus = 'pending' | 'paid' | 'failed' | 'cancelled'
/** `capped` = Stripe-gebyret oversteg provisjonen. Da er det prisen som må endres. */
export type FeeTrueupStatus = 'pending' | 'done' | 'not_needed' | 'capped' | 'failed'
export type EmailLogStatus = 'pending' | 'sent' | 'failed'
export type MarketingTaskKey =
  | 'publish_event_page'
  | 'activate_ticket_sales'
  | 'upload_poster'
  | 'create_facebook_event'
  | 'share_facebook_groups'
  | 'send_calendar_partners'
  | 'schedule_email'
export type MarketingDesignFileType = 'image'

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
  /** @deprecated Erstattet av `club_locations` i migrasjon 026. */
  location_name: string | null
  /** @deprecated Erstattet av `club_locations` i migrasjon 026. */
  address_line: string | null
  city: string | null
  /** Hex (#rrggbb) hentet fra logoen ved opplasting. Null = standard Tickethalo-aksent. */
  brand_color: string | null
  /** ISO 4217. Standardvaluta for nye show i klubben. */
  currency: string

  // Selgeridentitet. Klubben er selger og arrangør — Tickethalo formidler.
  legal_name: string | null
  org_number: string | null
  support_email: string | null

  // Stripe Connect. Betalingen opprettes på denne kontoen (direct charge).
  stripe_account_id: string | null
  charges_enabled: boolean
  payouts_enabled: boolean
  onboarding_completed_at: string | null
  requirements_due: unknown | null

  /** Formidlingsprovisjon i basispunkter. 1000 = 10 %. */
  platform_fee_bps: number
  /** 0 = provisjonen er unntatt etter mval. § 3-7. */
  commission_vat_bps: number
  /** Dager etter showdato før utbetaling frigis. */
  payout_hold_days: number
  /** Tickethalo dekker Stripe-gebyret av sin provisjon. */
  absorb_stripe_fee: boolean

  created_at: string
  updated_at: string
}

export type ClubLocation = {
  id: string
  club_id: string
  name: string
  address_line: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export type CitySubscriber = {
  id: string
  email: string
  /** Bynavn, eller 'alle' når besøkende ikke hadde filtrert på en by. */
  city: string
  source: string | null
  created_at: string
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
  bio: string | null
  category: ArtistType[] | null
  city: string | null
  /** ISO 3166-1 alpha-2. */
  country: string | null
  /** ISO 639-1-koder. */
  languages: string[] | null
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
  created_at: string
  updated_at: string
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

  // Hovedbok. Klubben eier billettinntekten; Tickethalos eneste inntekt er
  // `platform_fee_amount`. Se migrasjon 032.
  club_id: string | null
  stripe_connected_account_id: string | null
  stripe_charge_id: string | null
  stripe_application_fee_id: string | null
  gross_amount: number | null
  platform_fee_amount: number | null
  stripe_fee_amount: number | null
  club_net_amount: number | null
  fee_trueup_amount: number | null
  fee_trueup_status: FeeTrueupStatus
  payment_method_type: string | null
  refunded_at: string | null
  refund_reason: string | null

  created_at: string
  updated_at: string
}

export type ClubPayout = {
  id: string
  club_id: string
  amount: number
  currency: string
  stripe_payout_id: string | null
  period_start: string | null
  period_end: string | null
  status: ClubPayoutStatus
  failure_reason: string | null
  created_at: string
  updated_at: string
  paid_at: string | null
}

export type ClubSettlement = {
  id: string
  club_id: string
  period_start: string
  period_end: string
  gross_amount: number
  commission_amount: number
  commission_vat_amount: number
  refunded_amount: number
  net_amount: number
  currency: string
  document_number: string | null
  issued_at: string | null
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

export type ShowArtistBookingExclusion = {
  id: string
  show_id: string
  artist_id: string
  reason: string | null
  created_at: string
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
          bio?: string | null
          category?: ArtistType[] | null
          city?: string | null
          country?: string | null
          languages?: string[] | null
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
          club_id?: string | null
          stripe_connected_account_id?: string | null
          stripe_charge_id?: string | null
          stripe_application_fee_id?: string | null
          gross_amount?: number | null
          platform_fee_amount?: number | null
          stripe_fee_amount?: number | null
          club_net_amount?: number | null
          fee_trueup_amount?: number | null
          fee_trueup_status?: FeeTrueupStatus
          payment_method_type?: string | null
          refunded_at?: string | null
          refund_reason?: string | null
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
          brand_color?: string | null
          currency?: string
          legal_name?: string | null
          org_number?: string | null
          support_email?: string | null
          stripe_account_id?: string | null
          charges_enabled?: boolean
          payouts_enabled?: boolean
          onboarding_completed_at?: string | null
          requirements_due?: unknown | null
          platform_fee_bps?: number
          commission_vat_bps?: number
          payout_hold_days?: number
          absorb_stripe_fee?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Club>
        Relationships: []
      }
      club_locations: {
        Row: ClubLocation
        Insert: {
          id?: string
          club_id: string
          name: string
          address_line?: string | null
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: Partial<ClubLocation>
        Relationships: []
      }
      club_payouts: {
        Row: ClubPayout
        Insert: {
          id?: string
          club_id: string
          amount: number
          currency?: string
          stripe_payout_id?: string | null
          period_start?: string | null
          period_end?: string | null
          status?: ClubPayoutStatus
          failure_reason?: string | null
          created_at?: string
          updated_at?: string
          paid_at?: string | null
        }
        Update: Partial<ClubPayout>
        Relationships: []
      }
      club_settlements: {
        Row: ClubSettlement
        Insert: {
          id?: string
          club_id: string
          period_start: string
          period_end: string
          gross_amount?: number
          commission_amount?: number
          commission_vat_amount?: number
          refunded_amount?: number
          net_amount?: number
          currency?: string
          document_number?: string | null
          issued_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<ClubSettlement>
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
      city_subscribers: {
        Row: CitySubscriber
        Insert: {
          id?: string
          email: string
          city?: string
          source?: string | null
          created_at?: string
        }
        Update: Partial<CitySubscriber>
        Relationships: []
      }
    }
    Views: {
      /** Solgte billetter per show. Se migrasjon 031. */
      show_ticket_counts: {
        Row: {
          show_id: string
          sold_tickets: number
        }
        Relationships: []
      }
    }
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
          p_club_id?: string | null
          p_connected_account_id?: string | null
          p_charge_id?: string | null
          p_application_fee_id?: string | null
          p_platform_fee_amount?: number | null
          p_payment_method_type?: string | null
        }
        Returns: {
          result: 'created' | 'duplicate' | 'sold_out' | 'invalid_show'
          order_id: string
          ticket_code: string | null
          duplicate: boolean
        }[]
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
