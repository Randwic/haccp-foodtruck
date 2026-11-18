// Icônes au trait Lucide (lucide-react, licence ISC/MIT), centralisées ici : taille et épaisseur homogènes,
// toujours décoratives (aria-hidden) — le libellé est porté par le texte ou l'aria-label du bouton.
// Aucun emoji ni pictogramme Unicode dans les écrans : on passe toujours par ce fichier.
import type { ComponentType } from 'react'
import {
  Circle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Gauge,
  ListChecks,
  RefreshCcw,
  TestTube,
  ArrowRightLeft,
  Ban,
  Box,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  CalendarDays,
  CalendarClock,
  Copy,
  PackageOpen,
  Printer,
  ShoppingBasket,
  Soup,
  TableProperties,
  Wheat,
  ChefHat,
  CircleCheck,
  CircleExclamationPoint,
  ClipboardCheck,
  Clock,
  CloudCheck,
  CloudExclamationPoint,
  CloudUpload,
  CookingPot,
  Delete,
  Droplets,
  Ellipsis,
  Flag,
  Eye,
  EyeOff,
  Flame,
  FolderOpen,
  History,
  ImageOff,
  Info,
  Lock,
  LogOut,
  Minus,
  Mail,
  Package,
  PackageMinus,
  PackageX,
  Pencil,
  Play,
  Phone,
  Plus,
  Refrigerator,
  Settings,
  Share,
  SlidersHorizontal,
  Snowflake,
  Target,
  SprayCan,
  Store,
  Truck,
  SquarePlus,
  Tag,
  Thermometer,
  ThermometerSun,
  Timer,
  Trash2,
  ThermometerSnowflake,
  TriangleExclamationPoint,
  Users,
  WifiOff,
  Wrench,
  X,
  ScanBarcode,
  ScanText,
  PackageSearch,
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
export const IconChevronUp = make(ChevronUp, 'IconChevronUp')
export const IconChevronDown = make(ChevronDown, 'IconChevronDown')
export const IconDelete = make(Delete, 'IconDelete')
export const IconLock = make(Lock, 'IconLock')
export const IconLogOut = make(LogOut, 'IconLogOut')
export const IconEye = make(Eye, 'IconEye')
export const IconEyeOff = make(EyeOff, 'IconEyeOff')
export const IconShare = make(Share, 'IconShare')
export const IconAddHome = make(SquarePlus, 'IconAddHome')
export const IconEdit = make(Pencil, 'IconEdit')
export const IconHistory = make(History, 'IconHistory')

// États
export const IconOk = make(CircleCheck, 'IconOk')
export const IconWarn = make(TriangleExclamationPoint, 'IconWarn')
export const IconError = make(CircleExclamationPoint, 'IconError')
export const IconInfo = make(Info, 'IconInfo')
/** Rond vide : « peut en contenir » (traces). */
export const IconCircle = make(Circle, 'IconCircle')
export const IconSynced = make(CloudCheck, 'IconSynced')
export const IconSyncPending = make(CloudUpload, 'IconSyncPending')
export const IconSyncError = make(CloudExclamationPoint, 'IconSyncError')
export const IconOffline = make(WifiOff, 'IconOffline')
export const IconDue = make(Clock, 'IconDue')

// Actions correctives
export const IconDiscard = make(Trash2, 'IconDiscard')
export const IconMove = make(ArrowRightLeft, 'IconMove')
export const IconWrench = make(Wrench, 'IconWrench')
export const IconPhone = make(Phone, 'IconPhone')
export const IconMore = make(Ellipsis, 'IconMore')

// Modules HACCP
export const IconTemperature = make(Thermometer, 'IconTemperature')
export const IconCooling = make(ThermometerSnowflake, 'IconCooling')
export const IconDelivery = make(Package, 'IconDelivery')
export const IconLabel = make(Tag, 'IconLabel')
export const IconCleaning = make(SprayCan, 'IconCleaning')
export const IconOil = make(Droplets, 'IconOil')
export const IconDocuments = make(FolderOpen, 'IconDocuments')
export const IconSystemTest = make(ClipboardCheck, 'IconSystemTest')
export const IconReheating = make(ThermometerSun, 'IconReheating')
export const IconCooking = make(ChefHat, 'IconCooking')
export const IconThawing = make(Snowflake, 'IconThawing')

// Procédés
export const IconTimer = make(Timer, 'IconTimer')
export const IconStart = make(Play, 'IconStart')
export const IconFinish = make(Flag, 'IconFinish')
export const IconCalendar = make(CalendarDays, 'IconCalendar')

// Équipements
export const IconFridge = make(Refrigerator, 'IconFridge')
export const IconSnowflake = make(Snowflake, 'IconSnowflake')
export const IconThermometerCheck = make(Target, 'IconThermometerCheck')
export const IconFryer = make(CookingPot, 'IconFryer')
export const IconFlame = make(Flame, 'IconFlame')
export const IconBox = make(Box, 'IconBox')

// Gestion
export const IconUsers = make(Users, 'IconUsers')
export const IconSettings = make(Settings, 'IconSettings')
export const IconSliders = make(SlidersHorizontal, 'IconSliders')

// Réception & traçabilité (lot 3)
export const IconCamera = make(Camera, 'IconCamera')
export const IconBarcode = make(ScanBarcode, 'IconBarcode')
export const IconScanText = make(ScanText, 'IconScanText')
export const IconRecall = make(PackageSearch, 'IconRecall')
export const IconImageOff = make(ImageOff, 'IconImageOff')
export const IconSupplier = make(Store, 'IconSupplier')
export const IconTruck = make(Truck, 'IconTruck')
export const IconRefused = make(PackageX, 'IconRefused')
export const IconWaste = make(PackageMinus, 'IconWaste')
export const IconBan = make(Ban, 'IconBan')
export const IconMail = make(Mail, 'IconMail')

// Étiquettes, produits, recettes, allergènes (lot 4)
export const IconPrint = make(Printer, 'IconPrint')
export const IconOpened = make(PackageOpen, 'IconOpened')
export const IconRecipe = make(Soup, 'IconRecipe')
export const IconProduct = make(ShoppingBasket, 'IconProduct')
export const IconAllergen = make(Wheat, 'IconAllergen')
export const IconTable = make(TableProperties, 'IconTable')
export const IconDlc = make(CalendarClock, 'IconDlc')
export const IconCopies = make(Copy, 'IconCopies')

// Nettoyage, checklists, huiles (lot 5)
export const IconChecklist = make(ListChecks, 'IconChecklist')
export const IconGauge = make(Gauge, 'IconGauge')
export const IconOilChange = make(RefreshCcw, 'IconOilChange')
export const IconStrip = make(TestTube, 'IconStrip')
export const IconMoveUp = make(ArrowUp, 'IconMoveUp')
export const IconMoveDown = make(ArrowDown, 'IconMoveDown')
