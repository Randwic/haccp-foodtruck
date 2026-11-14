// Icônes au trait Lucide (lucide-react, licence ISC/MIT), centralisées ici : taille et épaisseur homogènes,
// toujours décoratives (aria-hidden) — le libellé est porté par le texte ou l'aria-label du bouton.
// Aucun emoji ni pictogramme Unicode dans les écrans : on passe toujours par ce fichier.
import type { ComponentType } from 'react'
import {
  ArrowLeft,
  Box,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleExclamationPoint,
  ClipboardCheck,
  CloudCheck,
  CloudExclamationPoint,
  CloudUpload,
  CookingPot,
  Delete,
  Droplets,
  Eye,
  EyeOff,
  Flame,
  FolderOpen,
  Info,
  Lock,
  LogOut,
  Minus,
  Package,
  Plus,
  Refrigerator,
  Settings,
  Share,
  SlidersHorizontal,
  Snowflake,
  SprayCan,
  SquarePlus,
  Tag,
  Thermometer,
  ThermometerSnowflake,
  TriangleExclamationPoint,
  Users,
  WifiOff,
  X,
  type LucideProps,
} from 'lucide-react'

export type IconProps = Omit<LucideProps, 'ref'> & { size?: number }

/** Épaisseur unique pour toute l'app. */
export const ICON_STROKE = 1.75

function make(Icon: ComponentType<LucideProps>, name: string) {
  const C = ({ size = 22, strokeWidth = ICON_STROKE, ...rest }: IconProps) => (
    <Icon size={size} strokeWidth={strokeWidth} aria-hidden="true" focusable="false" {...rest} />
  )
  C.displayName = name
  return C
}

// Actions
export const IconPlus = make(Plus, 'IconPlus')
export const IconMinus = make(Minus, 'IconMinus')
export const IconCheck = make(Check, 'IconCheck')
export const IconClose = make(X, 'IconClose')
export const IconArrowLeft = make(ArrowLeft, 'IconArrowLeft')
export const IconChevronLeft = make(ChevronLeft, 'IconChevronLeft')
export const IconChevronRight = make(ChevronRight, 'IconChevronRight')
export const IconDelete = make(Delete, 'IconDelete')
export const IconLock = make(Lock, 'IconLock')
export const IconLogOut = make(LogOut, 'IconLogOut')
export const IconEye = make(Eye, 'IconEye')
export const IconEyeOff = make(EyeOff, 'IconEyeOff')
export const IconShare = make(Share, 'IconShare')
export const IconAddHome = make(SquarePlus, 'IconAddHome')

// États
export const IconOk = make(CircleCheck, 'IconOk')
export const IconWarn = make(TriangleExclamationPoint, 'IconWarn')
export const IconError = make(CircleExclamationPoint, 'IconError')
export const IconInfo = make(Info, 'IconInfo')
export const IconSynced = make(CloudCheck, 'IconSynced')
export const IconSyncPending = make(CloudUpload, 'IconSyncPending')
export const IconSyncError = make(CloudExclamationPoint, 'IconSyncError')
export const IconOffline = make(WifiOff, 'IconOffline')

// Modules HACCP
export const IconTemperature = make(Thermometer, 'IconTemperature')
export const IconCooling = make(ThermometerSnowflake, 'IconCooling')
export const IconDelivery = make(Package, 'IconDelivery')
export const IconLabel = make(Tag, 'IconLabel')
export const IconCleaning = make(SprayCan, 'IconCleaning')
export const IconOil = make(Droplets, 'IconOil')
export const IconDocuments = make(FolderOpen, 'IconDocuments')
export const IconSystemTest = make(ClipboardCheck, 'IconSystemTest')

// Équipements
export const IconFridge = make(Refrigerator, 'IconFridge')
export const IconSnowflake = make(Snowflake, 'IconSnowflake')
export const IconFryer = make(CookingPot, 'IconFryer')
export const IconFlame = make(Flame, 'IconFlame')
export const IconBox = make(Box, 'IconBox')

// Gestion
export const IconUsers = make(Users, 'IconUsers')
export const IconSettings = make(Settings, 'IconSettings')
export const IconSliders = make(SlidersHorizontal, 'IconSliders')
