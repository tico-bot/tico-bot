package com.example.zeca.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Tab
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.example.zeca.AtualizacaoDenuncia

enum class PoliticaCla(val rotulo: String) {
    PUBLICO("Entrada livre"),
    CONVITE("Somente por convite"),
    APROVACAO("Solicitação com aprovação"),
}

data class MembroClã(
    val userId: String,
    val nome: String,
    val isLider: Boolean = false,
    val pontuacaoSemanal: Int = 0,
)

data class ClaSocial(
    val id: String,
    val nome: String,
    val descricao: String,
    val politica: PoliticaCla,
    val membros: List<MembroClã>,
    val liderId: String,
    val codigoConvite: String? = null,
    val solicitacoesPendentes: List<MembroClã> = emptyList(),
    val pontuacaoSemanal: Int = 0,
)

data class ConviteClaSocial(
    val clanId: String,
    val nomeCla: String,
    val convidadoPor: String,
)

data class RascunhoCla(
    val nome: String,
    val descricao: String,
    val politica: PoliticaCla,
)

data class EntradaRankingCla(
    val posicao: Int,
    val claId: String,
    val nomeCla: String,
    val pontuacao: Int,
)

data class EventoSemanal(
    val id: String,
    val tema: String,
    val descricao: String,
    val progresso: Int,
    val meta: Int,
    val recompensa: String,
    val recompensaResgatada: Boolean = false,
)

data class ConquistaSocial(
    val id: String,
    val nome: String,
    val descricao: String,
    val simbolo: String,
    val desbloqueada: Boolean,
    val progresso: Int = 0,
    val meta: Int = 0,
)

data class PartidaHistoricoSocial(
    val id: String,
    val nomeJogo: String,
    val resultado: String,
    val resumo: String,
    val data: String,
)

data class EstatisticaJogoSocial(
    val nomeJogo: String,
    val partidas: Int,
    val vitorias: Int,
    val derrotas: Int,
    val sequenciaAtual: Int,
)

enum class CategoriaDenuncia(val rotulo: String) {
    ASSÉDIO("Assédio ou ofensas"),
    TRAPAÇA("Trapaça"),
    SPAM("Spam"),
    CONTEUDO("Conteúdo impróprio"),
    OUTRO("Outro"),
}

data class DenunciaSocial(
    val usuarioAlvoId: String?,
    val categoria: CategoriaDenuncia,
    val detalhes: String,
)

data class EstadoCarregamentoSocial(
    val clãsCarregando: Boolean = false,
    val eventoCarregando: Boolean = false,
    val conquistasCarregando: Boolean = false,
    val historicoCarregando: Boolean = false,
    val erros: Map<String, String> = emptyMap(),
)

private val corDestaqueSocial = Color(0xFF18C991)
private val corFundoSocial = Color(0xFF101821)
private val corCartaoSocial = Color(0xFF1A2631)
private val secoesSociais = listOf("Clãs", "Evento", "Conquistas", "Histórico", "Denunciar")

@Composable
fun TelaRecursosSociais(
    usuarioAtualId: String,
    clas: List<ClaSocial>,
    convites: List<ConviteClaSocial> = emptyList(),
    claAtualId: String?,
    rankingClas: List<EntradaRankingCla>,
    eventoSemanal: EventoSemanal?,
    conquistas: List<ConquistaSocial>,
    historico: List<PartidaHistoricoSocial>,
    estatisticasPorJogo: List<EstatisticaJogoSocial>,
    atualizacoesDenuncias: List<AtualizacaoDenuncia>,
    estado: EstadoCarregamentoSocial = EstadoCarregamentoSocial(),
    onCriarCla: (RascunhoCla, (Exception?) -> Unit) -> Unit,
    onEntrarCla: (String, (Exception?) -> Unit) -> Unit,
    onSolicitarEntradaCla: (String, (Exception?) -> Unit) -> Unit,
    onEntrarComConvite: (String, (Exception?) -> Unit) -> Unit,
    onAceitarConvite: (String, (Exception?) -> Unit) -> Unit,
    onSairCla: (String, (Exception?) -> Unit) -> Unit,
    onConvidarUsuario: (String, String, (Exception?) -> Unit) -> Unit,
    onAprovarSolicitacao: (String, String, (Exception?) -> Unit) -> Unit,
    onRemoverMembro: (String, String, (Exception?) -> Unit) -> Unit,
    onResgatarRecompensa: (String, (Exception?) -> Unit) -> Unit,
    onEnviarDenuncia: (DenunciaSocial, (Exception?) -> Unit) -> Unit,
) {
    var secaoSelecionada by rememberSaveable { mutableStateOf(0) }
    var mostrarCriacao by rememberSaveable { mutableStateOf(false) }
    var retornoAcao by remember { mutableStateOf<String?>(null) }
    var acaoEmAndamento by remember { mutableStateOf(false) }
    val claAtual = clas.firstOrNull { it.id == claAtualId }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(corFundoSocial)
            .verticalScroll(rememberScrollState())
            .padding(bottom = 24.dp),
    ) {
        Column(Modifier.padding(horizontal = 20.dp, vertical = 18.dp)) {
            Text("Comunidade", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = Color.White)
            Text("Jogue em equipe, acompanhe seu progresso e mantenha o jogo respeitoso.", color = Color(0xFFB7C4CC))
        }
        PrimaryTabRow(
            selectedTabIndex = secaoSelecionada,
            containerColor = corFundoSocial,
            contentColor = corDestaqueSocial,
        ) {
            secoesSociais.forEachIndexed { index, titulo ->
                Tab(
                    selected = secaoSelecionada == index,
                    onClick = { secaoSelecionada = index },
                    text = { Text(titulo, maxLines = 1) },
                )
            }
        }

        retornoAcao?.let { mensagem ->
            Text(
                mensagem,
                color = if (mensagem.startsWith("Erro:")) Color(0xFFFF8A80) else corDestaqueSocial,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
        }

        when (secaoSelecionada) {
            0 -> ConteudoClas(
                clas = clas,
                convites = convites,
                claAtual = claAtual,
                usuarioAtualId = usuarioAtualId,
                ranking = rankingClas,
                carregando = estado.clãsCarregando,
                erro = estado.erros["clãs"],
                mostrarCriacao = mostrarCriacao,
                aoAlternarCriacao = { mostrarCriacao = !mostrarCriacao },
                emAndamento = acaoEmAndamento,
                aoExecutarAcao = { acao ->
                    acaoEmAndamento = true
                    retornoAcao = null
                    acao { erro ->
                        acaoEmAndamento = false
                        retornoAcao = erro?.let { "Erro: ${it.localizedMessage ?: "não foi possível concluir a ação."}" }
                            ?: "Ação concluída."
                    }
                },
                onCriarCla = onCriarCla,
                onEntrarCla = onEntrarCla,
                onSolicitarEntradaCla = onSolicitarEntradaCla,
                onEntrarComConvite = onEntrarComConvite,
                onAceitarConvite = onAceitarConvite,
                onSairCla = onSairCla,
                onConvidarUsuario = onConvidarUsuario,
                onAprovarSolicitacao = onAprovarSolicitacao,
                onRemoverMembro = onRemoverMembro,
            )
            1 -> ConteudoEvento(eventoSemanal, estado.eventoCarregando, estado.erros["evento"], acaoEmAndamento) { id ->
                executarAcao(id, onResgatarRecompensa) { ocupado, mensagem ->
                    acaoEmAndamento = ocupado
                    retornoAcao = mensagem
                }
            }
            2 -> ConteudoConquistas(conquistas, estado.conquistasCarregando, estado.erros["conquistas"])
            3 -> ConteudoHistorico(historico, estatisticasPorJogo, estado.historicoCarregando, estado.erros["histórico"])
            else -> FormularioDenuncia(acaoEmAndamento, atualizacoesDenuncias) { denuncia ->
                acaoEmAndamento = true
                retornoAcao = null
                onEnviarDenuncia(denuncia) { erro ->
                    acaoEmAndamento = false
                    retornoAcao = erro?.let { "Erro: ${it.localizedMessage ?: "não foi possível enviar a denúncia."}" }
                        ?: "Denúncia enviada. Obrigado por ajudar a comunidade."
                }
            }
        }
    }
}

private fun executarAcao(
    id: String,
    acao: (String, (Exception?) -> Unit) -> Unit,
    retorno: (Boolean, String?) -> Unit,
) {
    retorno(true, null)
    acao(id) { erro ->
        retorno(false, erro?.let { "Erro: ${it.localizedMessage ?: "não foi possível concluir a ação."}" } ?: "Ação concluída.")
    }
}

@Composable
private fun ConteudoClas(
    clas: List<ClaSocial>,
    convites: List<ConviteClaSocial>,
    claAtual: ClaSocial?,
    usuarioAtualId: String,
    ranking: List<EntradaRankingCla>,
    carregando: Boolean,
    erro: String?,
    mostrarCriacao: Boolean,
    aoAlternarCriacao: () -> Unit,
    emAndamento: Boolean,
    aoExecutarAcao: (((Exception?) -> Unit) -> Unit) -> Unit,
    onCriarCla: (RascunhoCla, (Exception?) -> Unit) -> Unit,
    onEntrarCla: (String, (Exception?) -> Unit) -> Unit,
    onSolicitarEntradaCla: (String, (Exception?) -> Unit) -> Unit,
    onEntrarComConvite: (String, (Exception?) -> Unit) -> Unit,
    onAceitarConvite: (String, (Exception?) -> Unit) -> Unit,
    onSairCla: (String, (Exception?) -> Unit) -> Unit,
    onConvidarUsuario: (String, String, (Exception?) -> Unit) -> Unit,
    onAprovarSolicitacao: (String, String, (Exception?) -> Unit) -> Unit,
    onRemoverMembro: (String, String, (Exception?) -> Unit) -> Unit,
) {
    var codigoConvite by rememberSaveable { mutableStateOf("") }
    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        erro?.let { MensagemEstado("Não foi possível carregar os clãs: $it", erro = true) }
        if (carregando) IndicadorCarregamento("Carregando clãs…")
        if (claAtual != null) {
            CartaoSocial {
                Text("Seu clã", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = corDestaqueSocial)
                Spacer(Modifier.height(6.dp))
                Text(claAtual.nome, style = MaterialTheme.typography.headlineSmall, color = Color.White, fontWeight = FontWeight.Bold)
                Text(claAtual.descricao, color = Color(0xFFB7C4CC))
                Text("${claAtual.membros.size}/20 membros • ${claAtual.politica.rotulo}", color = Color(0xFFB7C4CC))
                claAtual.codigoConvite?.takeIf { it.isNotBlank() }?.let { codigo ->
                    Text("Código de convite: $codigo", color = Color(0xFFFFD166), fontWeight = FontWeight.SemiBold)
                }
                if (claAtual.liderId == usuarioAtualId) {
                    CampoConvite(claAtual.id, emAndamento, onConvidarUsuario, aoExecutarAcao)
                    if (claAtual.solicitacoesPendentes.isNotEmpty()) {
                        HorizontalDivider(color = Color(0xFF34434F))
                        Text("Solicitações pendentes", fontWeight = FontWeight.SemiBold, color = Color.White)
                        claAtual.solicitacoesPendentes.forEach { membro ->
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                                Text(membro.nome, color = Color.White)
                                TextButton(
                                    enabled = !emAndamento,
                                    onClick = { aoExecutarAcao { done -> onAprovarSolicitacao(claAtual.id, membro.userId, done) } },
                                ) { Text("Aprovar") }
                            }
                        }
                    }
                    HorizontalDivider(color = Color(0xFF34434F))
                    Text("Membros", fontWeight = FontWeight.SemiBold, color = Color.White)
                    claAtual.membros.forEach { membro ->
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                            Text(
                                "${membro.nome}${if (membro.isLider || membro.userId == claAtual.liderId) " • líder" else ""}",
                                color = Color.White,
                                modifier = Modifier.weight(1f),
                            )
                            if (membro.userId != usuarioAtualId && membro.userId != claAtual.liderId) {
                                TextButton(
                                    enabled = !emAndamento,
                                    onClick = { aoExecutarAcao { done -> onRemoverMembro(claAtual.id, membro.userId, done) } },
                                ) { Text("Remover") }
                            }
                        }
                    }
                    OutlinedButton(
                        enabled = !emAndamento,
                        onClick = { aoExecutarAcao { done -> onSairCla(claAtual.id, done) } },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Sair do clã") }
                } else {
                    OutlinedButton(
                        enabled = !emAndamento,
                        onClick = { aoExecutarAcao { done -> onSairCla(claAtual.id, done) } },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Sair do clã") }
                }
            }
        }

        if (claAtual == null && convites.isNotEmpty()) {
            CartaoSocial {
                Text("Convites recebidos", style = MaterialTheme.typography.titleMedium, color = Color.White, fontWeight = FontWeight.Bold)
                convites.forEach { convite ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(convite.nomeCla, color = Color.White, modifier = Modifier.weight(1f))
                        TextButton(
                            enabled = !emAndamento,
                            onClick = { aoExecutarAcao { done -> onAceitarConvite(convite.clanId, done) } },
                        ) { Text("Aceitar") }
                    }
                }
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
            Text("Encontrar um clã", style = MaterialTheme.typography.titleLarge, color = Color.White, fontWeight = FontWeight.Bold)
            TextButton(onClick = aoAlternarCriacao) { Text(if (mostrarCriacao) "Fechar" else "Criar clã") }
        }
        if (mostrarCriacao) FormularioCriarCla(emAndamento, onCriarCla, aoExecutarAcao)
        CartaoSocial {
            Text("Entrar com código de convite", fontWeight = FontWeight.SemiBold, color = Color.White)
            OutlinedTextField(
                value = codigoConvite,
                onValueChange = { codigoConvite = it },
                label = { Text("Código") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                enabled = codigoConvite.isNotBlank() && !emAndamento,
                onClick = { aoExecutarAcao { done -> onEntrarComConvite(codigoConvite.trim(), done) } },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Usar convite") }
        }
        clas.filter { it.id != claAtual?.id }.forEach { cla ->
            CartaoSocial {
                Text(cla.nome, style = MaterialTheme.typography.titleMedium, color = Color.White, fontWeight = FontWeight.Bold)
                Text(cla.descricao, color = Color(0xFFB7C4CC))
                Text("${cla.membros.size}/20 membros • ${cla.politica.rotulo}", color = Color(0xFFB7C4CC))
                if (cla.membros.size >= 20) {
                    Text("Clã completo", color = Color(0xFFFFD166), fontWeight = FontWeight.SemiBold)
                } else
                when (cla.politica) {
                    PoliticaCla.PUBLICO -> BotaoSocial("Entrar no clã", emAndamento) {
                        aoExecutarAcao { done -> onEntrarCla(cla.id, done) }
                    }
                    PoliticaCla.APROVACAO -> BotaoSocial("Solicitar entrada", emAndamento) {
                        aoExecutarAcao { done -> onSolicitarEntradaCla(cla.id, done) }
                    }
                    PoliticaCla.CONVITE -> Text(
                        if (cla.codigoConvite.isNullOrBlank()) "Este clã aceita apenas convites." else "Use o código de convite para entrar.",
                        color = Color(0xFFB7C4CC),
                    )
                }
            }
        }
        CartaoSocial {
            Text("Ranking semanal dos clãs", style = MaterialTheme.typography.titleMedium, color = Color.White, fontWeight = FontWeight.Bold)
            if (ranking.isEmpty()) Text("O ranking ainda não tem resultados.", color = Color(0xFFB7C4CC))
            ranking.sortedBy { it.posicao }.forEach { entrada ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("#${entrada.posicao}  ${entrada.nomeCla}", color = Color.White)
                    Text("${entrada.pontuacao} pts", color = corDestaqueSocial, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun CampoConvite(
    claId: String,
    emAndamento: Boolean,
    onConvidarUsuario: (String, String, (Exception?) -> Unit) -> Unit,
    aoExecutarAcao: (((Exception?) -> Unit) -> Unit) -> Unit,
) {
    var usuarioId by rememberSaveable(claId) { mutableStateOf("") }
    Text("Convidar pessoa", color = Color.White, fontWeight = FontWeight.SemiBold)
    OutlinedTextField(
        value = usuarioId,
        onValueChange = { usuarioId = it },
        label = { Text("ID do usuário") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    Button(
        enabled = usuarioId.isNotBlank() && !emAndamento,
        onClick = { aoExecutarAcao { done -> onConvidarUsuario(claId, usuarioId.trim(), done) } },
        modifier = Modifier.fillMaxWidth(),
    ) { Text("Enviar convite") }
}

@Composable
private fun FormularioCriarCla(
    emAndamento: Boolean,
    onCriarCla: (RascunhoCla, (Exception?) -> Unit) -> Unit,
    aoExecutarAcao: (((Exception?) -> Unit) -> Unit) -> Unit,
) {
    var nome by rememberSaveable { mutableStateOf("") }
    var descricao by rememberSaveable { mutableStateOf("") }
    var politica by rememberSaveable { mutableStateOf(PoliticaCla.PUBLICO) }
    CartaoSocial {
        Text("Novo clã • até 20 membros", style = MaterialTheme.typography.titleMedium, color = Color.White, fontWeight = FontWeight.Bold)
        OutlinedTextField(nome, { nome = it }, label = { Text("Nome") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(
            descricao,
            { descricao = it },
            label = { Text("Descrição") },
            minLines = 2,
            modifier = Modifier.fillMaxWidth(),
        )
        PoliticaCla.entries.forEach { opcao ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { politica = opcao },
            ) {
                RadioButton(selected = politica == opcao, onClick = { politica = opcao })
                Text(opcao.rotulo, color = Color.White)
            }
        }
        Button(
            enabled = nome.isNotBlank() && !emAndamento,
            onClick = {
                val rascunho = RascunhoCla(nome.trim(), descricao.trim(), politica)
                aoExecutarAcao { done -> onCriarCla(rascunho, done) }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Criar clã") }
    }
}

@Composable
private fun ConteudoEvento(
    evento: EventoSemanal?,
    carregando: Boolean,
    erro: String?,
    emAndamento: Boolean,
    aoResgatar: (String) -> Unit,
) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        erro?.let { MensagemEstado("Não foi possível carregar o evento: $it", erro = true) }
        if (carregando) IndicadorCarregamento("Carregando evento semanal…")
        if (evento == null) {
            if (!carregando) MensagemEstado("Nenhum evento semanal ativo no momento.")
        } else CartaoSocial {
            Text("EVENTO DA SEMANA", color = corDestaqueSocial, fontWeight = FontWeight.Bold)
            Text(evento.tema, style = MaterialTheme.typography.headlineSmall, color = Color.White, fontWeight = FontWeight.Bold)
            Text(evento.descricao, color = Color(0xFFB7C4CC))
            val progresso = evento.progresso.coerceAtLeast(0)
            val meta = evento.meta.coerceAtLeast(1)
            LinearProgressIndicator(
                progress = { (progresso.toFloat() / meta).coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth(),
                color = corDestaqueSocial,
            )
            Text("$progresso / ${evento.meta} concluídos", color = Color.White)
            Text("Recompensa: ${evento.recompensa}", color = Color(0xFFFFD166), fontWeight = FontWeight.SemiBold)
            Button(
                enabled = evento.progresso >= evento.meta && !evento.recompensaResgatada && !emAndamento,
                onClick = { aoResgatar(evento.id) },
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (evento.recompensaResgatada) "Recompensa resgatada" else "Resgatar recompensa") }
        }
    }
}

@Composable
private fun ConteudoConquistas(conquistas: List<ConquistaSocial>, carregando: Boolean, erro: String?) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        erro?.let { MensagemEstado("Não foi possível carregar as conquistas: $it", erro = true) }
        if (carregando) IndicadorCarregamento("Carregando conquistas…")
        if (conquistas.isEmpty() && !carregando) MensagemEstado("Suas medalhas conquistadas e próximas metas aparecerão aqui.")
        conquistas.forEach { conquista ->
            CartaoSocial {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        conquista.simbolo.ifBlank { "★" },
                        color = if (conquista.desbloqueada) Color(0xFFFFD166) else Color(0xFF84929C),
                        style = MaterialTheme.typography.headlineMedium,
                    )
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(conquista.nome, color = Color.White, fontWeight = FontWeight.Bold)
                        Text(conquista.descricao, color = Color(0xFFB7C4CC))
                        if (!conquista.desbloqueada && conquista.meta > 0) {
                            val meta = conquista.meta.coerceAtLeast(1)
                            LinearProgressIndicator(
                                progress = { (conquista.progresso.toFloat() / meta).coerceIn(0f, 1f) },
                                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                                color = corDestaqueSocial,
                            )
                            Text("${conquista.progresso} / ${conquista.meta}", color = Color(0xFFB7C4CC))
                        } else if (conquista.desbloqueada) Text("Desbloqueada", color = corDestaqueSocial)
                    }
                }
            }
        }
    }
}

@Composable
private fun ConteudoHistorico(
    historico: List<PartidaHistoricoSocial>,
    estatisticas: List<EstatisticaJogoSocial>,
    carregando: Boolean,
    erro: String?,
) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        erro?.let { MensagemEstado("Não foi possível carregar o histórico: $it", erro = true) }
        if (carregando) IndicadorCarregamento("Carregando histórico…")
        Text("Estatísticas por jogo", style = MaterialTheme.typography.titleLarge, color = Color.White, fontWeight = FontWeight.Bold)
        if (estatisticas.isEmpty() && !carregando) MensagemEstado("Ainda não há estatísticas disponíveis.")
        estatisticas.forEach { stat ->
            CartaoSocial {
                Text(stat.nomeJogo, color = Color.White, fontWeight = FontWeight.Bold)
                Text("${stat.partidas} partidas • ${stat.vitorias} vitórias • ${stat.derrotas} derrotas", color = Color(0xFFB7C4CC))
                Text("Sequência atual: ${stat.sequenciaAtual}", color = corDestaqueSocial)
            }
        }
        Text("Partidas recentes", style = MaterialTheme.typography.titleLarge, color = Color.White, fontWeight = FontWeight.Bold)
        if (historico.isEmpty() && !carregando) MensagemEstado("Suas partidas recentes aparecerão aqui.")
        historico.forEach { partida ->
            CartaoSocial {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (partida.resultado.equals("vitória", true) || partida.resultado.equals("vitoria", true)) "V" else "•",
                        color = corDestaqueSocial,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .background(Color(0xFF263A40), CircleShape)
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                    )
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text("${partida.nomeJogo} • ${partida.resultado}", color = Color.White, fontWeight = FontWeight.SemiBold)
                        Text(partida.resumo, color = Color(0xFFB7C4CC))
                        Text(partida.data, color = Color(0xFF84929C), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

@Composable
private fun FormularioDenuncia(
    emAndamento: Boolean,
    atualizacoes: List<AtualizacaoDenuncia>,
    onEnviar: (DenunciaSocial) -> Unit,
) {
    var usuarioAlvo by rememberSaveable { mutableStateOf("") }
    var detalhes by rememberSaveable { mutableStateOf("") }
    var categoria by rememberSaveable { mutableStateOf(CategoriaDenuncia.ASSÉDIO) }
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        CartaoSocial {
            Text("Denunciar comportamento", style = MaterialTheme.typography.titleLarge, color = Color.White, fontWeight = FontWeight.Bold)
            Text(
                "Envie uma denúncia para análise. Compartilhe apenas informações relevantes; denúncias são tratadas com confidencialidade.",
                color = Color(0xFFB7C4CC),
            )
            OutlinedTextField(
                value = usuarioAlvo,
                onValueChange = { usuarioAlvo = it },
                label = { Text("ID do usuário") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Text("Categoria", color = Color.White, fontWeight = FontWeight.SemiBold)
            Column {
                CategoriaDenuncia.entries.forEach { opcao ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth().clickable { categoria = opcao },
                    ) {
                        RadioButton(selected = categoria == opcao, onClick = { categoria = opcao })
                        Text(opcao.rotulo, color = Color.White)
                    }
                }
            }
            OutlinedTextField(
                value = detalhes,
                onValueChange = { detalhes = it },
                label = { Text("Detalhes") },
                placeholder = { Text("O que aconteceu? Inclua contexto relevante.") },
                minLines = 4,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                enabled = usuarioAlvo.isNotBlank() && detalhes.trim().length >= 10 && !emAndamento,
                onClick = {
                    onEnviar(
                        DenunciaSocial(
                            usuarioAlvoId = usuarioAlvo.trim().ifBlank { null },
                            categoria = categoria,
                            detalhes = detalhes.trim(),
                        ),
                    )
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (emAndamento) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else Text("Enviar denúncia")
            }
        }
        if (atualizacoes.isNotEmpty()) {
            CartaoSocial {
                Text("Acompanhamento das suas denúncias", style = MaterialTheme.typography.titleMedium, color = Color.White, fontWeight = FontWeight.Bold)
                atualizacoes.forEach { report ->
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("${nomeStatusDenuncia(report.status)} · ${nomeCategoria(report.categoria)}", color = corDestaqueSocial, fontWeight = FontWeight.SemiBold)
                        if (report.motivo.isNotBlank()) {
                            Text("Atualização da moderação: ${report.motivo}", color = Color(0xFFB7C4CC))
                        }
                    }
                    HorizontalDivider(color = Color(0xFF34434F))
                }
            }
        }
    }
}

private fun nomeStatusDenuncia(status: String): String = when (status) {
    "reviewing" -> "Em análise"
    "resolved" -> "Resolvida"
    "dismissed" -> "Encerrada sem ação"
    else -> "Recebida"
}

private fun nomeCategoria(categoria: String): String = when (categoria) {
    "harassment" -> "Assédio ou ofensas"
    "cheating" -> "Trapaça"
    "spam" -> "Spam"
    "inappropriate_content" -> "Conteúdo impróprio"
    else -> "Outro"
}

@Composable
private fun CartaoSocial(conteudo: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = corCartaoSocial),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            content = conteudo,
        )
    }
}

@Composable
private fun BotaoSocial(texto: String, desabilitado: Boolean, onClick: () -> Unit) {
    Button(enabled = !desabilitado, onClick = onClick, modifier = Modifier.fillMaxWidth()) { Text(texto) }
}

@Composable
private fun MensagemEstado(texto: String, erro: Boolean = false) {
    Text(
        texto,
        color = if (erro) Color(0xFFFF8A80) else Color(0xFFB7C4CC),
        modifier = Modifier
            .fillMaxWidth()
            .background(corCartaoSocial, RoundedCornerShape(12.dp))
            .padding(14.dp),
    )
}

@Composable
private fun IndicadorCarregamento(texto: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
    ) {
        CircularProgressIndicator(Modifier.size(20.dp), color = corDestaqueSocial, strokeWidth = 2.dp)
        Text(texto, color = Color(0xFFB7C4CC))
    }
}
