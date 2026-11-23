import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'Ocorreu um erro inesperado na interface.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('MOVIX ErrorBoundary:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, message: '' });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#06070B] text-[#F6F7FB] flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl bg-[#0F131E] border border-white/[0.1] p-6 sm:p-7 text-center shadow-2xl">
            <div className="mx-auto mb-4 h-12 w-12 rounded-xl bg-[#E5B85A]/12 border border-[#E5B85A]/25 flex items-center justify-center">
              <AlertTriangle className="h-6 w-6 text-[#F3C669]" aria-hidden="true" />
            </div>
            <h1 className="text-lg font-bold text-[#F6F7FB]">Algo saiu do esperado</h1>
            <p className="mt-2 text-sm text-[#9CA6BC] leading-relaxed">
              Não foi possível exibir esta tela no momento. Recarregue o aplicativo para restaurar sua sessão com segurança.
            </p>
            <button
              type="button"
              onClick={this.handleReset}
              className="mt-6 w-full h-11 rounded-xl bg-gradient-to-r from-[#D9A441] via-[#F3C669] to-[#D9A441] text-[#090B11] font-semibold text-sm flex items-center justify-center gap-2 hover:brightness-105 transition-all cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              <span>Recarregar MOVIX</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
