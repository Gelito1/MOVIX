import { useState } from 'react';
import { Check, Copy, FileText, Lock, Scale, ShieldCheck, X } from 'lucide-react';
import { CURRENT_TERMS_VERSION } from '../lib/firebase';

export type LegalTabId = 'termos' | 'privacidade' | 'dmca' | 'seguranca';

interface LegalDocsModalProps {
  open: boolean;
  initialTab?: LegalTabId;
  onClose: () => void;
  onAccept?: () => void;
}

const TABS: Array<{ id: LegalTabId; label: string; icon: typeof FileText }> = [
  { id: 'termos', label: 'Termos de Uso', icon: FileText },
  { id: 'privacidade', label: 'Privacidade (LGPD)', icon: Lock },
  { id: 'dmca', label: 'Aviso Legal & DMCA', icon: Scale },
  { id: 'seguranca', label: 'Segurança & Suporte', icon: ShieldCheck },
];

export function LegalDocsModal({
  open,
  initialTab = 'termos',
  onClose,
  onAccept,
}: LegalDocsModalProps) {
  const [activeTab, setActiveTab] = useState<LegalTabId>(initialTab);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  if (!open) return null;

  const copyContact = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmail(email);
      setTimeout(() => setCopiedEmail(null), 2200);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="movix-legal-title"
    >
      <div className="w-full max-w-2xl max-h-[90vh] sm:max-h-[85vh] flex flex-col rounded-t-3xl sm:rounded-2xl bg-[#0D111B] border border-white/[0.1] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 sm:px-6 py-4 border-b border-white/[0.08]">
          <div>
            <h2 id="movix-legal-title" className="text-base sm:text-lg font-bold text-[#F6F7FB]">
              Central Legal &amp; Transparência MOVIX
            </h2>
            <p className="text-xs text-[#8D97AF] mt-0.5">
              Versão {CURRENT_TERMS_VERSION} · Atualizado em Novembro de 2026
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar documentos legais"
            className="h-10 w-10 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-[#C8D0E0] flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Interactive Tab Selector */}
        <div className="px-4 sm:px-6 pt-3 pb-2 border-b border-white/[0.07] overflow-x-auto scrollbar-none">
          <div className="flex items-center gap-1.5 min-w-max">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-[#E5B85A]/15 text-[#F3C669] border border-[#E5B85A]/30'
                      : 'text-[#9BA5BC] hover:text-[#F6F7FB] hover:bg-white/[0.05] border border-transparent'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable Legal Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-5 text-sm text-[#C8D0E0] leading-relaxed">
          {activeTab === 'termos' && (
            <>
              <section className="space-y-2">
                <h3 className="text-base font-semibold text-[#F6F7FB]">1. Natureza do Serviço</h3>
                <p>
                  O <strong className="text-[#F6F7FB]">MOVIX</strong> é uma plataforma digital de
                  catálogo, organização e reprodução de mídia voltada para filmes, séries, animes,
                  doramas e documentários. O uso do aplicativo é pessoal, intransferível e não
                  comercial.
                </p>
              </section>

              <section className="space-y-2 border-t border-white/[0.06] pt-4">
                <h3 className="text-base font-semibold text-[#F6F7FB]">2. Conta e Responsabilidade do Usuário</h3>
                <p>
                  Ao criar sua conta com Google ou E-mail, você é responsável por manter a
                  confidencialidade das suas credenciais e pelas ações realizadas no seu perfil.
                  Você pode sincronizar sua lista de favoritos, preferências de idioma e controle de
                  notificações entre dispositivos.
                </p>
              </section>

              <section className="space-y-2 border-t border-white/[0.06] pt-4">
                <h3 className="text-base font-semibold text-[#F6F7FB]">3. Classificação Indicativa e Controle Parental</h3>
                <p>
                  O MOVIX exibe classificações etárias fornecidas pelas bases de metadados e protege
                  a seção Adulto (+18) com verificação de idade e PIN de acesso. Responsáveis legais
                  devem supervisionar o uso por menores de idade.
                </p>
              </section>

              <section className="space-y-2 border-t border-white/[0.06] pt-4">
                <h3 className="text-base font-semibold text-[#F6F7FB]">4. Atualizações e Disponibilidade</h3>
                <p>
                  Para garantir segurança e compatibilidade com navegadores e dispositivos móveis, o
                  MOVIX envia avisos automáticos sempre que uma nova versão do aplicativo estiver
                  disponível.
                </p>
              </section>
            </>
          )}

          {activeTab === 'privacidade' && (
            <>
              <section className="space-y-2">
                <h3 className="text-base font-semibold text-[#F6F7FB]">1. Dados Coletados (LGPD)</h3>
                <p>
                  Em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018),
                  coletamos apenas os dados essenciais para sua experiência: nome de exibição,
                  endereço de e-mail (isolado em coleção privada protegida), idioma preferido,
                  preferência de notificações e itens da sua lista de favoritos.
                </p>
              </section>

              <section className="space-y-2 border-t border-white/[0.06] pt-4">
                <h3 className="text-base font-semibold text-[#F6F7FB]">2. Isolamento de Dados Pessoais</h3>
                <p>
                  Seu endereço de e-mail nunca é exposto publicamente a outros usuários. Todas as
                  leituras e gravações são autenticadas via Firebase Authentication e protegidas por
                  regras estritas de propriedade por conta.
                </p>
              </section>

              <section className="space-y-2 border-t border-white/[0.06] pt-4">
                <h3 className="text-base font-semibold text-[#F6F7FB]">3. Cache Local e Modo Offline</h3>
                <p>
                  Quando você ativa o recurso <strong className="text-[#F6F7FB]">Assistir Offline</strong>,
                  metadados e capas dos itens escolhidos são armazenados temporariamente no Cache do
                  Service Worker do seu dispositivo por até 7 dias, podendo ser removidos a qualquer
                  momento na seção Minha Lista.
                </p>
              </section>

              <section className="space-y-2 border-t border-white/[0.06] pt-4">
                <h3 className="text-base font-semibold text-[#F6F7FB]">4. Seus Direitos</h3>
                <p>
                  Você pode solicitar acesso, correção ou exclusão definitiva dos seus dados e da
                  sua conta a qualquer momento através do nosso canal de privacidade abaixo.
                </p>
              </section>
            </>
          )}

          {activeTab === 'dmca' && (
            <>
              <section className="space-y-2">
                <h3 className="text-base font-semibold text-[#F6F7FB]">1. Hospedagem e Fontes Externas</h3>
                <p>
                  O MOVIX não hospeda nem armazena arquivos de vídeo em servidores próprios. Todo o
                  catálogo de sinopses, avaliações, elencos e imagens é fornecido pela API pública
                  do TMDB (The Movie Database), e a reprodução ocorre exclusivamente por meio de
                  fontes e servidores externos integrados.
                </p>
              </section>

              <section className="space-y-2 border-t border-white/[0.06] pt-4">
                <h3 className="text-base font-semibold text-[#F6F7FB]">2. Direitos Autorais e Remoção (DMCA)</h3>
                <p>
                  Respeitamos integralmente a propriedade intelectual de estúdios, produtores e
                  detentores de direitos. Caso identifique qualquer referência que viole direitos
                  autorais, envie uma notificação formal identificando a obra e a URL correspondente
                  para nossa equipe jurídica:
                </p>
                <div className="pt-1 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-[#F3C669]">legal@movix.app</span>
                  <button
                    type="button"
                    onClick={() => void copyContact('legal@movix.app')}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs text-[#E5E9F2] cursor-pointer"
                  >
                    {copiedEmail === 'legal@movix.app' ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Copiar e-mail</span>
                      </>
                    )}
                  </button>
                </div>
              </section>

              <section className="space-y-2 border-t border-white/[0.06] pt-4">
                <h3 className="text-base font-semibold text-[#F6F7FB]">3. Atribuição TMDB</h3>
                <p>
                  Este produto utiliza a API do TMDB, mas não é endossado ou certificado pelo TMDB.
                  Todas as marcas e logotipos de serviços de streaming exibidos nos filtros pertencem
                  aos seus respectivos proprietários.
                </p>
              </section>
            </>
          )}

          {activeTab === 'seguranca' && (
            <>
              <section className="space-y-2">
                <h3 className="text-base font-semibold text-[#F6F7FB]">1. Proteção de Sessão</h3>
                <p>
                  As conexões do aplicativo utilizam criptografia HTTPS ponta a ponta e autenticação
                  gerenciada pelo Firebase Authentication (Google OAuth 2.0 e E-mail verificado).
                </p>
              </section>

              <section className="space-y-2 border-t border-white/[0.06] pt-4">
                <h3 className="text-base font-semibold text-[#F6F7FB]">2. Notificações Transparentes</h3>
                <p>
                  Você decide se deseja receber alertas de lançamentos e atualizações. Essa
                  permissão pode ser revogada ou reativada a qualquer momento nas configurações da
                  sua Conta ou do navegador.
                </p>
              </section>

              <section className="space-y-2 border-t border-white/[0.06] pt-4">
                <h3 className="text-base font-semibold text-[#F6F7FB]">3. Canal Oficial de Suporte</h3>
                <p>
                  Para dúvidas técnicas, recuperação de conta ou sugestões de melhoria, entre em
                  contato com nossa equipe:
                </p>
                <div className="pt-1 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-[#F3C669]">suporte@movix.app</span>
                  <button
                    type="button"
                    onClick={() => void copyContact('suporte@movix.app')}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs text-[#E5E9F2] cursor-pointer"
                  >
                    {copiedEmail === 'suporte@movix.app' ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Copiar e-mail</span>
                      </>
                    )}
                  </button>
                </div>
              </section>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 sm:px-6 py-4 border-t border-white/[0.08] bg-[#090C14] flex items-center justify-end gap-3">
          {onAccept ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="h-11 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-sm font-medium text-[#C8D0E0] transition-colors cursor-pointer"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => {
                  onAccept();
                  onClose();
                }}
                className="h-11 px-6 rounded-xl bg-gradient-to-r from-[#D9A441] via-[#F3C669] to-[#D9A441] text-[#090B11] text-sm font-semibold hover:brightness-105 transition-all cursor-pointer"
              >
                Concordar e Fechar
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="h-11 px-6 rounded-xl bg-gradient-to-r from-[#D9A441] via-[#F3C669] to-[#D9A441] text-[#090B11] text-sm font-semibold hover:brightness-105 transition-all cursor-pointer"
            >
              Entendi
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
