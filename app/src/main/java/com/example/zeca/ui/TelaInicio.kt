package com.example.zeca.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.example.zeca.Aba
import com.example.zeca.EstadoMissoes
import com.example.zeca.JogadorRanking
import com.example.zeca.PerfilPublico
import com.example.zeca.ui.theme.Cores

private data class FotoPerfilAmpliada(
    val apelido: String,
    val username: String,
    val moldura: String,
    val avatarUrl: String,
    val avatarItens: List<String>,
    val avatarComoFoto: Boolean,
)

@Composable
private fun DialogoFotoPerfil(foto: FotoPerfilAmpliada, onFechar: () -> Unit) {
    Dialog(
        onDismissRequest = onFechar,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(
            modifier = Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.94f)),
            contentAlignment = Alignment.Center,
        ) {
            IconButton(
                onClick = onFechar,
                modifier = Modifier.align(Alignment.TopEnd).padding(16.dp),
            ) {
                Icon(Icons.Filled.Close, contentDescription = "Fechar foto", tint = Color.White)
            }
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                AvatarComMoldura(
                    inicial = foto.apelido.take(1).uppercase(),
                    moldura = foto.moldura,
                    tamanho = 260.dp,
                    photoUrl = foto.avatarUrl,
                    avatarItems = foto.avatarItens,
                    avatarAsProfilePhoto = foto.avatarComoFoto,
                )
                Text(foto.apelido, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                if (foto.username.isNotBlank()) {
                    Text("@${foto.username}", color = Cores.Turquesa, fontSize = 14.sp)
                }
            }
        }
    }
}

@Composable
fun TelaInicio(
    saldoCentavos: Long,
    atividadeRecente: List<String>,
    ranking: List<JogadorRanking> = emptyList(),
    erroSincronizacao: String = "",
    ganhoTotalCentavos: Long = 0L,
    perdaTotalCentavos: Long = 0L,
    onCarregarMissoes: ((EstadoMissoes?, Exception?) -> Unit) -> Unit,
    onAbrirAba: (Aba) -> Unit,
    onAbrirLoja: () -> Unit,
    onBuscarPerfil: (String, (PerfilPublico?, Exception?) -> Unit) -> Unit,
) {
    var jogadorAberto by remember { mutableStateOf<JogadorRanking?>(null) }
    var perfilPublico by remember { mutableStateOf<PerfilPublico?>(null) }
    var fotoAmpliada by remember { mutableStateOf<FotoPerfilAmpliada?>(null) }
    var erroPerfil by remember { mutableStateOf("") }
    var carregandoPerfil by remember { mutableStateOf(false) }
    var missoes by remember { mutableStateOf<EstadoMissoes?>(null) }

    LaunchedEffect(Unit) {
        onCarregarMissoes { state, _ -> missoes = state }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(Color(0xFF151A1D), Cores.Fundo, Color(0xFF090D10)),
                ),
            ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, top = 36.dp, end = 20.dp, bottom = 112.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text("ZECA  /  SOCIAL CLUB", color = Cores.Verde, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Text("Boa sorte hoje.", color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Black)
                if (erroSincronizacao.isNotBlank()) {
                    Text(erroSincronizacao, color = Cores.Laranja, fontSize = 12.sp)
                }
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        Brush.linearGradient(
                            listOf(Color.White.copy(alpha = 0.19f), Color.White.copy(alpha = 0.07f), Cores.Verde.copy(alpha = 0.12f)),
                        ),
                        RoundedCornerShape(24.dp),
                    )
                    .border(
                        1.dp,
                        Brush.linearGradient(listOf(Color.White.copy(alpha = 0.62f), Color.White.copy(alpha = 0.12f))),
                        RoundedCornerShape(24.dp),
                    )
                    .padding(20.dp),
            ) {
                Text("SALDO", color = Color.White.copy(alpha = 0.68f), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(6.dp))
                Text(formatarReais(saldoCentavos), color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Black)
                Spacer(Modifier.height(18.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ResumoGanhoPerda("GANHOS", formatarReais(ganhoTotalCentavos), Cores.Verde, Modifier.weight(1f))
                    ResumoGanhoPerda("PERDAS", formatarReais(perdaTotalCentavos), Color(0xFFFF8790), Modifier.weight(1f))
                }
                Spacer(Modifier.height(14.dp))
                AcaoCarteira("Ir para a loja", Modifier.fillMaxWidth(), true) { onAbrirLoja() }
            }

            missoes?.let { state ->
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Missões", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    MissaoProgresso("Diária", "Conclua 5 partidas hoje", state.diaria)
                    MissaoProgresso(
                        "Esportiva diária",
                        "Conclua uma múltipla com pelo menos 2 partidas hoje",
                        state.diariaEsportiva,
                    )
                    MissaoProgresso("Semanal", "Conclua 25 partidas nesta semana", state.semanal)
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Jogos populares", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    JogoItem("Slots", Cores.Laranja, Modifier.weight(1f)) { onAbrirAba(Aba.Jogos) }
                    JogoItem("Roleta", Cores.Turquesa, Modifier.weight(1f)) { onAbrirAba(Aba.Jogos) }
                    JogoItem("Crash", Color(0xFFFF8290), Modifier.weight(1f)) { onAbrirAba(Aba.Jogos) }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Atividade recente", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color.White.copy(alpha = 0.07f), RoundedCornerShape(18.dp))
                        .border(1.dp, Color.White.copy(alpha = 0.15f), RoundedCornerShape(18.dp))
                        .padding(16.dp),
                ) {
                    if (atividadeRecente.isEmpty()) {
                        Text("Suas partidas e movimentações aparecerão aqui.", color = Color.White.copy(alpha = 0.65f), fontSize = 14.sp)
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            atividadeRecente.forEach { item ->
                                Text(item, color = Color.White.copy(alpha = 0.82f), fontSize = 14.sp)
                            }
                        }
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Ranking de saldo", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                if (ranking.isEmpty()) {
                    Text("O ranking aparecerá quando outros jogadores entrarem.", color = Color.White.copy(alpha = 0.65f), fontSize = 13.sp)
                } else {
                    ranking.take(10).forEachIndexed { index, jogador ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(Color.White.copy(alpha = 0.07f), RoundedCornerShape(15.dp))
                                .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(15.dp))
                                .clickable {
                                    jogadorAberto = jogador
                                    perfilPublico = null
                                    erroPerfil = ""
                                    carregandoPerfil = true
                                    onBuscarPerfil(jogador.uid) { perfil, erro ->
                                        if (jogadorAberto?.uid == jogador.uid) {
                                            carregandoPerfil = false
                                            perfilPublico = perfil
                                            erroPerfil = erro?.localizedMessage
                                                ?: if (perfil == null) "Não foi possível carregar o perfil." else ""
                                        }
                                    }
                                }
                                .padding(horizontal = 14.dp, vertical = 12.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                        ) {
                            AvatarComMoldura(
                                inicial = jogador.apelido.take(1).uppercase(),
                                moldura = jogador.molduraEquipada,
                                tamanho = 34.dp,
                                modifier = Modifier.clickable(onClickLabel = "Ampliar foto de ${jogador.apelido}") {
                                    val perfilAtual = perfilPublico?.takeIf { it.uid == jogador.uid }
                                    fotoAmpliada = FotoPerfilAmpliada(
                                        apelido = jogador.apelido,
                                        username = jogador.username,
                                        moldura = perfilAtual?.molduraEquipada ?: jogador.molduraEquipada,
                                        avatarUrl = jogador.avatarUrl,
                                        avatarItens = jogador.avatarItensEquipados,
                                        avatarComoFoto = jogador.avatarComoFotoPerfil,
                                    )
                                },
                                photoUrl = jogador.avatarUrl,
                                avatarItems = jogador.avatarItensEquipados,
                                avatarAsProfilePhoto = jogador.avatarComoFotoPerfil,
                            )
                            Text("${index + 1}", color = Cores.Verde, fontSize = 16.sp, fontWeight = FontWeight.Black)
                            Column(modifier = Modifier.weight(1f)) {
                                Text(jogador.apelido, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                                Text(
                                    listOf(jogador.username.takeIf { it.isNotBlank() }?.let { "@$it" }, "Nível ${jogador.nivel}")
                                        .filterNotNull().joinToString(" · "),
                                    color = Color.White.copy(alpha = 0.58f),
                                    fontSize = 11.sp,
                                )
                            }
                            Text(formatarReais(jogador.saldoCentavos), color = Cores.Turquesa, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                Text("Toque em um jogador para ver o perfil e a chave Pix.", color = Color.White.copy(alpha = 0.52f), fontSize = 11.sp)
            }
        }

        jogadorAberto?.let { jogador ->
            TelaPerfilJogador(
                jogador = jogador,
                perfil = perfilPublico,
                carregando = carregandoPerfil,
                erro = erroPerfil,
                onFechar = { jogadorAberto = null },
            )
        }
        fotoAmpliada?.let { foto ->
            DialogoFotoPerfil(foto = foto, onFechar = { fotoAmpliada = null })
        }
    }
}

@Composable
private fun MissaoProgresso(titulo: String, descricao: String, missao: com.example.zeca.ProgressoMissao) {
    val progresso = if (missao.meta > 0) {
        (missao.progresso.toFloat() / missao.meta).coerceIn(0f, 1f)
    } else {
        0f
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color.White.copy(alpha = 0.055f), RoundedCornerShape(10.dp))
            .border(1.dp, Color.White.copy(alpha = 0.1f), RoundedCornerShape(10.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Row(horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(titulo, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                Text(descricao, color = Color.White.copy(alpha = 0.6f), fontSize = 10.sp)
            }
            Text(
                "+${formatarReais(missao.recompensaCentavos)}",
                color = Cores.Verde,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
            )
        }
        LinearProgressIndicator(
            progress = { progresso },
            modifier = Modifier.fillMaxWidth(),
            color = Cores.Verde,
            trackColor = Color.White.copy(alpha = 0.1f),
        )
        Text(
            if (missao.concluida) "Concluída · prêmio creditado"
            else "${missao.progresso}/${missao.meta} partidas concluídas",
            color = if (missao.concluida) Cores.Verde else Color.White.copy(alpha = 0.55f),
            fontSize = 10.sp,
        )
    }
}

@Composable
private fun JogoItem(nome: String, cor: Color, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(
        modifier = modifier
            .height(88.dp)
            .background(
                Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.14f), Cores.Cartao.copy(alpha = 0.72f))),
                RoundedCornerShape(18.dp),
            )
            .border(1.dp, Color.White.copy(alpha = 0.19f), RoundedCornerShape(18.dp))
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalArrangement = Arrangement.Bottom,
    ) {
        Text(nome, color = cor, fontWeight = FontWeight.Bold, fontSize = 14.sp)
    }
}

@Composable
private fun AcaoCarteira(texto: String, modifier: Modifier, destaque: Boolean, onClick: () -> Unit) {
    Box(
        modifier = modifier
            .background(
                if (destaque) Color.White.copy(alpha = 0.92f) else Color.White.copy(alpha = 0.12f),
                RoundedCornerShape(14.dp),
            )
            .border(1.dp, Color.White.copy(alpha = 0.45f), RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 13.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            texto,
            color = if (destaque) Color(0xFF101416) else Color.White,
            fontWeight = FontWeight.Bold,
            fontSize = 13.sp,
        )
    }
}

@Composable
private fun ResumoGanhoPerda(rotulo: String, valor: String, cor: Color, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .background(Color.White.copy(alpha = 0.08f), RoundedCornerShape(14.dp))
            .border(1.dp, Color.White.copy(alpha = 0.18f), RoundedCornerShape(14.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(rotulo, color = Color.White.copy(alpha = 0.6f), fontSize = 10.sp, fontWeight = FontWeight.Bold)
        Text(valor, color = cor, fontSize = 15.sp, fontWeight = FontWeight.Black, maxLines = 1)
    }
}

@Composable
fun TelaEmBreve(titulo: String, descricao: String) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(titulo, color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text(descricao, color = Cores.Cinza, fontSize = 16.sp)
    }
}

@Composable
internal fun TelaPerfilJogador(
    jogador: JogadorRanking,
    perfil: PerfilPublico?,
    carregando: Boolean,
    erro: String,
    onFechar: () -> Unit,
    gruposEmComum: List<String> = emptyList(),
    onConversar: (() -> Unit)? = null,
) {
    var fotoAmpliada by remember { mutableStateOf<FotoPerfilAmpliada?>(null) }
    BackHandler(onBack = onFechar)
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF151A1D), Cores.Fundo, Color(0xFF090D10))))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, top = 28.dp, end = 20.dp, bottom = 118.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onFechar) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Voltar", tint = Color.White)
                }
                Text("Dados do jogador", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            }

            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                AvatarComMoldura(
                    jogador.apelido.take(1).uppercase(),
                    perfil?.molduraEquipada.orEmpty(),
                    112.dp,
                    modifier = Modifier.clickable(onClickLabel = "Ampliar foto de ${jogador.apelido}") {
                        fotoAmpliada = FotoPerfilAmpliada(
                            apelido = jogador.apelido,
                            username = perfil?.username ?: jogador.username,
                            moldura = perfil?.molduraEquipada.orEmpty(),
                            avatarUrl = perfil?.avatarUrl ?: jogador.avatarUrl,
                            avatarItens = perfil?.avatarItensEquipados ?: jogador.avatarItensEquipados,
                            avatarComoFoto = perfil?.avatarComoFotoPerfil ?: jogador.avatarComoFotoPerfil,
                        )
                    },
                    photoUrl = perfil?.avatarUrl ?: jogador.avatarUrl,
                    avatarItems = perfil?.avatarItensEquipados ?: jogador.avatarItensEquipados,
                    avatarAsProfilePhoto = perfil?.avatarComoFotoPerfil ?: jogador.avatarComoFotoPerfil,
                )
                Spacer(Modifier.height(6.dp))
                Text(jogador.apelido, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Black)
                if (jogador.username.isNotBlank()) Text("@${jogador.username}", color = Cores.Turquesa, fontSize = 13.sp)
                Text("Nível ${perfil?.nivel ?: jogador.nivel}", color = Color.White.copy(alpha = 0.6f), fontSize = 14.sp)
                perfil?.let { jogadorPerfil ->
                    Text(
                        "Moldura · ${catalogoLoja.firstOrNull { it.id == jogadorPerfil.molduraEquipada }?.nome ?: "Padrão"}",
                        color = Color.White.copy(alpha = 0.7f),
                        fontSize = 12.sp,
                    )
                    Text(
                        "Título · ${catalogoLoja.firstOrNull { it.id == jogadorPerfil.tituloEquipado }?.nome ?: "Nenhum"}",
                        color = Cores.Verde,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }

            when {
                carregando -> Text("Carregando perfil...", color = Color.White.copy(alpha = 0.7f), fontSize = 13.sp)
                perfil == null -> Text(
                    erro.ifBlank { "Não foi possível carregar o perfil." },
                    color = Cores.Laranja,
                    fontSize = 13.sp,
                )
                else -> {
                    SecaoJogador("Sobre mim") {
                        Text(
                            perfil.bio.ifBlank { "Este jogador ainda não escreveu uma bio." },
                            color = Color.White.copy(alpha = if (perfil.bio.isBlank()) 0.62f else 0.92f),
                            fontSize = 14.sp,
                        )
                    }
                    SecaoJogador("Estatísticas") {
                        DadoJogador("Saldo", formatarReais(perfil.saldoCentavos))
                        DadoJogador("Partidas", perfil.partidas.toString())
                        DadoJogador("Vitórias", perfil.vitorias.toString())
                        DadoJogador("Derrotas", (perfil.partidas - perfil.vitorias).coerceAtLeast(0).toString())
                        DadoJogador(
                            "Taxa de vitórias",
                            if (perfil.partidas > 0) {
                                "${(perfil.vitorias.coerceIn(0, perfil.partidas) * 100) / perfil.partidas}%"
                            } else "—",
                        )
                    }
                    if (gruposEmComum.isNotEmpty()) {
                        SecaoJogador("Grupos em comum") {
                            gruposEmComum.forEach { nomeGrupo ->
                                Text(nomeGrupo, color = Color.White, fontSize = 14.sp)
                            }
                        }
                    }
                    SecaoJogador("Coleção") {
                        ItensColecao(
                            perfil.inventario,
                            molduraEquipada = perfil.molduraEquipada,
                            tituloEquipado = perfil.tituloEquipado,
                            avatarItensEquipados = perfil.avatarItensEquipados,
                        )
                    }
                    if (onConversar != null) {
                        Button(onClick = onConversar, modifier = Modifier.fillMaxWidth()) { Text("Enviar mensagem") }
                    }
                }
            }
        }
        fotoAmpliada?.let { foto ->
            DialogoFotoPerfil(foto = foto, onFechar = { fotoAmpliada = null })
        }
    }
}

@Composable
private fun SecaoJogador(titulo: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color.White.copy(alpha = 0.07f), RoundedCornerShape(18.dp))
            .border(1.dp, Color.White.copy(alpha = 0.15f), RoundedCornerShape(18.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(titulo, color = Cores.Verde, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        content()
    }
}

@Composable
private fun DadoJogador(rotulo: String, valor: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(rotulo, color = Color.White.copy(alpha = 0.62f), fontSize = 13.sp)
        Text(valor, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    }
}