import type { Bank, Currency, MovementKind } from "../api/client";
import bancoDoBrasilLogo from "../assets/banks/banco_do_brasil.svg";
import itauLogo from "../assets/banks/itau.svg";
import nubankLogo from "../assets/banks/nubank.svg";

export const BANKS: Record<Bank, { name: string; logo: string }> = {
  nubank: { name: "Nubank", logo: nubankLogo },
  banco_do_brasil: { name: "Banco do Brasil", logo: bancoDoBrasilLogo },
  itau: { name: "Itaú", logo: itauLogo },
};

export const MOVEMENT_KIND_LABELS: Record<MovementKind, string> = {
  transfer: "Transferência",
  deposit: "Adição",
  withdrawal: "Retirada",
};

export const CURRENCIES: Record<Currency, string> = {
  BRL: "Real (R$)",
  USD: "Dólar americano (US$)",
  EUR: "Euro (€)",
};

/** Matches the API's "Sem categoria" color. */
export const UNCATEGORIZED_COLOR = "#94a3b8";

// Colorblind-friendly categorical palette; new categories take the next unused slot.
export const CATEGORY_PALETTE = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#6250d6",
  "#e34948",
];

export function nextCategoryColor(usedColors: string[]): string {
  const used = new Set(usedColors.map((c) => c.toLowerCase()));
  return CATEGORY_PALETTE.find((c) => !used.has(c)) ?? CATEGORY_PALETTE[0];
}

export const CATEGORY_ICONS: { icon: string; label: string }[] = [
  { icon: "🏠", label: "Casa" },
  { icon: "🍽️", label: "Refeição" },
  { icon: "🛒", label: "Supermercado" },
  { icon: "🚗", label: "Carro" },
  { icon: "🚌", label: "Transporte público" },
  { icon: "⛽", label: "Combustível" },
  { icon: "💊", label: "Saúde" },
  { icon: "🏋️", label: "Academia" },
  { icon: "🎬", label: "Lazer" },
  { icon: "✈️", label: "Viagem" },
  { icon: "🎓", label: "Educação" },
  { icon: "📚", label: "Livros" },
  { icon: "👕", label: "Roupas" },
  { icon: "💡", label: "Contas de casa" },
  { icon: "📱", label: "Celular e internet" },
  { icon: "🐶", label: "Pets" },
  { icon: "👶", label: "Filhos" },
  { icon: "🎁", label: "Presentes" },
  { icon: "💼", label: "Salário" },
  { icon: "💰", label: "Investimentos" },
  { icon: "💳", label: "Cartão de crédito" },
  { icon: "🧾", label: "Impostos" },
  { icon: "🔧", label: "Manutenção" },
  { icon: "🍎", label: "Alimentação" },
  { icon: "🔁", label: "Assinaturas" },
  { icon: "📺", label: "Streaming" },
  { icon: "💈", label: "Barbearia" },
  { icon: "🛍️", label: "Compras pessoais" },
  { icon: "✨", label: "Extras" },
  { icon: "⛪", label: "Igreja" },
  { icon: "🌐", label: "Internet" },
  { icon: "🐾", label: "Petshop" },
  { icon: "☕", label: "Café e lanches" },
  { icon: "🍔", label: "Delivery" },
  { icon: "🍺", label: "Bares" },
  { icon: "🎮", label: "Jogos" },
  { icon: "🎵", label: "Música" },
  { icon: "🏖️", label: "Férias" },
  { icon: "🎂", label: "Aniversários" },
  { icon: "🦷", label: "Dentista" },
  { icon: "💄", label: "Beleza" },
  { icon: "🧴", label: "Higiene" },
  { icon: "🚕", label: "Táxi e aplicativos" },
  { icon: "🏍️", label: "Moto" },
  { icon: "🅿️", label: "Estacionamento" },
  { icon: "🛡️", label: "Seguros" },
  { icon: "🏦", label: "Banco e tarifas" },
  { icon: "📈", label: "Rendimentos" },
  { icon: "🤝", label: "Doações" },
  { icon: "🛋️", label: "Móveis" },
  { icon: "🧹", label: "Limpeza" },
  { icon: "🔥", label: "Gás" },
  { icon: "💧", label: "Água" },
  { icon: "💻", label: "Tecnologia" },
  { icon: "🧸", label: "Brinquedos" },
  { icon: "📦", label: "Outros" },
];
