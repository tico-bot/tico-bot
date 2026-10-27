package com.example.zeca.ui

import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.example.zeca.JogadorRanking
import com.example.zeca.PredefinicaoSala
import com.example.zeca.SalaCaboGuerra
import com.example.zeca.ui.theme.Cores
import com.example.zeca.MensagemSalaJogo
import kotlinx.coroutines.delay
import java.math.BigDecimal
import java.text.NumberFormat
import java.util.Locale
import java.util.UUID

private data class TeamQuizQuestion(val prompt: String, val answers: List<String>)

private val teamQuizQuestions = listOf(
    TeamQuizQuestion("Quanto é 12 × 8?", listOf("86", "96", "108", "112")),
    TeamQuizQuestion("Qual é a capital do Japão?", listOf("Seul", "Pequim", "Tóquio", "Bangkok")),
    TeamQuizQuestion("Quantos lados tem um octógono?", listOf("6", "7", "8", "9")),
    TeamQuizQuestion("Qual gás as plantas absorvem?", listOf("Oxigênio", "Hélio", "Nitrogênio", "Dióxido de carbono")),
    TeamQuizQuestion("Qual é o maior mamífero do mundo?", listOf("Elefante", "Baleia-azul", "Girafa", "Hipopótamo")),
    TeamQuizQuestion("Quantos minutos há em uma hora e meia?", listOf("80", "90", "100", "120")),
    TeamQuizQuestion("Qual destes é um metal precioso?", listOf("Quartzo", "Granito", "Ouro", "Carvão")),
    TeamQuizQuestion("Em qual continente fica o Egito?", listOf("África", "Europa", "Ásia", "Oceania")),
)

@Composable
fun TelaCaboGuerra(
    uidAtual: String,
    clanId: String,
    modoInicial: String,
    gameIdInicial: String,
    saldoCentavos: Long,
    jogadores: List<JogadorRanking>,
    roomInviteId: String,
    onRoomInviteHandled: () -> Unit,
    onCarregarSalas: ((List<SalaCaboGuerra>, Exception?) -> Unit) -> Unit,
    onCarregarPredefinicoes: ((List<PredefinicaoSala>, Exception?) -> Unit) -> Unit,
    onSalvarPredefinicoes: (List<PredefinicaoSala>, (Exception?) -> Unit) -> Unit,
    onCarregarMensagens: (String, (List<MensagemSalaJogo>, Exception?) -> Unit) -> Unit,
    onEnviarMensagem: (String, String, String, String, (Exception?) -> Unit) -> Unit,
    onCriarSala: (Long, List<String>, String, String, String, String, String, (SalaCaboGuerra?, Exception?) -> Unit) -> Unit,
    onEntrarSala: (String, String, String, (SalaCaboGuerra?, Exception?) -> Unit) -> Unit,
    onGerenciarSala: (String, String, String, String, Long, String, (SalaCaboGuerra?, Exception?) -> Unit) -> Unit,
    onIniciarSala: (String, (SalaCaboGuerra?, Exception?) -> Unit) -> Unit,
    onPuxarCorda: (String, Int, String, (SalaCaboGuerra?, Exception?) -> Unit) -> Unit,
) {
    var salas by remember { mutableStateOf<List<SalaCaboGuerra>>(emptyList()) }
    var salaSelecionada by remember { mutableStateOf<SalaCaboGuerra?>(null) }
    var stakeTexto by rememberSaveable { mutableStateOf("10,00") }
    var senhaSala by rememberSaveable { mutableStateOf("") }
    var senhaEntrada by rememberSaveable { mutableStateOf("") }
    var filtroSalas by rememberSaveable { mutableStateOf("Todas") }
    var modoSala by rememberSaveable { mutableStateOf(if (gameIdInicial == "tug") modoInicial else "2v2") }
    var salaDoCla by rememberSaveable { mutableStateOf(false) }
    var predefinicoes by remember { mutableStateOf<List<PredefinicaoSala>>(emptyList()) }
    var nomePredefinicao by rememberSaveable(gameIdInicial) { mutableStateOf("") }
    var chatAberto by rememberSaveable { mutableStateOf(false) }
    var mensagensSala by remember { mutableStateOf<List<MensagemSalaJogo>>(emptyList()) }
    var textoMensagemSala by rememberSaveable { mutableStateOf("") }
    var erroChatSala by remember { mutableStateOf("") }
    var salaParaEntrar by remember { mutableStateOf<SalaCaboGuerra?>(null) }
    var carregando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf("") }
    var aviso by remember { mutableStateOf("") }
    var confirmarAcaoSala by remember { mutableStateOf<Pair<String, String>?>(null) }
    var puxoesPendentes by remember { mutableStateOf(0) }
    var enviandoLotePuxoes by remember { mutableStateOf(false) }
    var ultimoToqueMs by remember { mutableStateOf(0L) }
    var deepLinkResolvido by remember(roomInviteId) { mutableStateOf(roomInviteId.isBlank()) }
    val convidados = remember { mutableStateListOf<String>() }
    val jogadoresDisponiveis = jogadores.filter { it.uid != uidAtual }
    val haptic = LocalHapticFeedback.current
    val contexto = LocalContext.current

    LaunchedEffect(modoInicial, gameIdInicial) {
        modoSala = if (gameIdInicial != "tug" || modoInicial == "2v2") "2v2" else "1v1"
        if (roomInviteId.isBlank() && salaSelecionada?.gameId != gameIdInicial) salaSelecionada = null
    }

    fun atualizarSalas() {
        onCarregarSalas { rooms, error ->
            salas = rooms
            if (error != null) erro = error.localizedMessage.orEmpty()
            if (!deepLinkResolvido && roomInviteId.isNotBlank()) {
                val invitedRoom = rooms.firstOrNull { it.id == roomInviteId }
                if (invitedRoom != null) {
                    salaSelecionada = invitedRoom
                    aviso = "Convite para Cabo de Guerra aberto."
                } else if (error == null) {
                    erro = "Esta sala não existe mais ou você não tem convite para ela."
                }
                deepLinkResolvido = true
                onRoomInviteHandled()
            }
            salaSelecionada?.let { selected -> rooms.firstOrNull { it.id == selected.id }?.let { salaSelecionada = it } }
        }
    }

    LaunchedEffect(Unit) {
        atualizarSalas()
        while (true) {
            val refreshInterval = when (salaSelecionada?.status) {
                "active" -> 1_500L
                "ready" -> 8_000L
                else -> 60_000L
            }
            delay(refreshInterval)
            atualizarSalas()
        }
    }

    LaunchedEffect(chatAberto, salaSelecionada?.id) {
        val roomId = salaSelecionada?.id
        if (!chatAberto || roomId == null) {
            mensagensSala = emptyList()
            return@LaunchedEffect
        }
        while (true) {
            onCarregarMensagens(roomId) { messages, error ->
                if (error == null) {
                    mensagensSala = messages
                    erroChatSala = ""
                } else {
                    erroChatSala = error.localizedMessage ?: "Não foi possível carregar o chat."
                }
            }
            delay(2_000)
        }
    }

    LaunchedEffect(Unit) {
        onCarregarPredefinicoes { loaded, error ->
            if (error == null) predefinicoes = loaded
            else erro = error.localizedMessage ?: "Não foi possível carregar as predefinições."
        }
    }

    LaunchedEffect(salaSelecionada?.id) {
        puxoesPendentes = 0
        enviandoLotePuxoes = false
        ultimoToqueMs = 0L
    }

    LaunchedEffect(salaSelecionada?.id, salaSelecionada?.status, puxoesPendentes, enviandoLotePuxoes) {
        val room = salaSelecionada ?: return@LaunchedEffect
        if (room.status != "active" || enviandoLotePuxoes || puxoesPendentes == 0) return@LaunchedEffect
        delay(160)
        val currentRoom = salaSelecionada ?: return@LaunchedEffect
        if (currentRoom.id != room.id || currentRoom.status != "active" || enviandoLotePuxoes) return@LaunchedEffect
        val quizMode = room.gameId == "teamBlitz"
        val count = if (quizMode) puxoesPendentes else minOf(8, puxoesPendentes)
        puxoesPendentes = 0
        enviandoLotePuxoes = true
        onPuxarCorda(room.id, count, UUID.randomUUID().toString()) { next, error ->
            enviandoLotePuxoes = false
            if (salaSelecionada?.id == room.id) {
                if (error != null) {
                    erro = error.localizedMessage.orEmpty()
                    puxoesPendentes = 0
                    atualizarSalas()
                } else {
                    val acceptedPulls = next?.puxoesAceitos?.coerceIn(0, count) ?: count
                    if (quizMode) {
                        aviso = if (acceptedPulls > 0) "Resposta certa! +2 pontos para seu time."
                        else "Resposta errada. A próxima pergunta já está valendo."
                    } else if (next?.status == "active") {
                        puxoesPendentes += count - acceptedPulls
                    }
                    salaSelecionada = next
                }
            }
        }
    }

    fun apostarEmSala(amount: Long): Boolean {
        if (amount < 100L) {
            erro = "A aposta mínima é R$ 1,00."
            return false
        }
        if (amount > 1_000_000L) {
            erro = "A aposta máxima é R$ 10.000,00."
            return false
        }
        if (amount > saldoCentavos) {
            erro = "Saldo insuficiente para essa aposta."
            return false
        }
        return true
    }

    fun compartilharConvite(roomId: String) {
        val inviteLink = Uri.Builder()
            .scheme("zeca")
            .authority("tug")
            .appendPath(roomId)
            .build()
            .toString()
        val sendIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, "Entre na minha sala de Cabo de Guerra: $inviteLink")
        }
        contexto.startActivity(Intent.createChooser(sendIntent, "Compartilhar convite"))
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column {
                        val gameId = salaSelecionada?.gameId ?: gameIdInicial
                        Text("${nomeJogoEquipe(gameId)} · ${salaSelecionada?.modo ?: modoSala}", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                        Text(regraJogoEquipe(gameId), color = Color.White.copy(alpha = 0.58f), fontSize = 11.sp)
            }
            TextButton(onClick = { atualizarSalas() }, enabled = !carregando) { Text("Atualizar") }
        }
        Text("Aposta em créditos virtuais · prêmio ao vencedor: 2× a aposta", color = Cores.Turquesa, fontSize = 11.sp)

        salaSelecionada?.let { room ->
            val souCriador = room.criadorUid == uidAtual
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF11181B), RoundedCornerShape(12.dp))
                    .border(1.dp, Cores.Turquesa.copy(alpha = 0.4f), RoundedCornerShape(12.dp))
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("SALA ${room.id.take(8).uppercase()}", color = Cores.Turquesa, fontWeight = FontWeight.Black, fontSize = 11.sp)
                    Text(formatarSaldoTug(room.apostaCentavos), color = Cores.Verde, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                }
                val souTimeA = room.timeA.any { it.uid == uidAtual }
                val souTimeB = room.timeB.any { it.uid == uidAtual }
                val souParticipante = souTimeA || souTimeB
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("TIME A · ${room.puxoesTimeA}", color = Cores.Verde, fontWeight = FontWeight.Bold, fontSize = 10.sp)
                        Text(room.timeA.joinToString(" + ") { "${it.nome} · ${if (it.online) "Online" else "Offline"}" }.ifBlank { "Aguardando jogador" }, color = Color.White, fontSize = 10.sp)
                    }
                    Text("×", color = Color.White.copy(alpha = 0.5f), fontWeight = FontWeight.Bold)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("TIME B · ${room.puxoesTimeB}", color = Color(0xFFFF8B91), fontWeight = FontWeight.Bold, fontSize = 10.sp)
                        Text(room.timeB.joinToString(" + ") { "${it.nome} · ${if (it.online) "Online" else "Offline"}" }.ifBlank { "Aguardando jogador" }, color = Color.White, fontSize = 10.sp)
                    }
                }
                if (souParticipante && room.status in listOf("ready", "active", "settled")) {
                    OutlinedButton(onClick = { chatAberto = true }) { Text("Chat da partida") }
                }
                if (souCriador && room.status in listOf("waiting", "ready")) {
                    Text("Transferir liderança", color = Cores.Turquesa, fontWeight = FontWeight.Bold, fontSize = 11.sp)
                    (room.timeA + room.timeB).filter { it.uid != uidAtual }.forEach { player ->
                        TextButton(
                            enabled = !carregando,
                            onClick = {
                                carregando = true
                                onGerenciarSala(
                                    room.id,
                                    "transferLeadership",
                                    UUID.randomUUID().toString(),
                                    player.uid,
                                    0,
                                    "",
                                ) { next, error ->
                                    carregando = false
                                    if (error != null) erro = error.localizedMessage.orEmpty()
                                    else {
                                        salaSelecionada = next
                                        aviso = "Liderança transferida para ${player.nome}."
                                    }
                                }
                            },
                        ) { Text("Tornar ${player.nome} anfitrião") }
                    }
                }
                when (room.status) {
                    "waiting" -> {
                        Text(if (room.protegidaPorSenha) "Sala com senha" else "Sala aguardando jogador", color = Color.White.copy(alpha = 0.62f), fontSize = 11.sp)
                        if (souCriador) {
                            OutlinedTextField(
                                value = stakeTexto,
                                onValueChange = { stakeTexto = it.filter { char -> char.isDigit() || char == ',' || char == '.' }.take(12) },
                                modifier = Modifier.fillMaxWidth(),
                                label = { Text("Aposta por jogador") },
                                prefix = { Text("R$ ") },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(onClick = {
                                    val amount = parseSaldoTug(stakeTexto)
                                    if (amount == null || !apostarEmSala(amount)) return@Button
                                    carregando = true
                                    onGerenciarSala(room.id, "setStake", UUID.randomUUID().toString(), "", amount, "") { next, error ->
                                        carregando = false
                                        if (error != null) erro = error.localizedMessage.orEmpty() else salaSelecionada = next
                                    }
                                }, enabled = !carregando, colors = ButtonDefaults.buttonColors(containerColor = Cores.Turquesa)) {
                                    Text("Atualizar aposta", color = Color(0xFF101417), fontSize = 11.sp)
                                }
                                Button(onClick = {
                                    carregando = true
                                    onGerenciarSala(room.id, "setPassword", UUID.randomUUID().toString(), "", 0, senhaSala) { next, error ->
                                        carregando = false
                                        if (error != null) erro = error.localizedMessage.orEmpty() else {
                                            salaSelecionada = next
                                            senhaSala = ""
                                            aviso = if (next?.protegidaPorSenha == true) "Senha da sala atualizada." else "Senha removida."
                                        }
                                    }
                                }, enabled = !carregando, colors = ButtonDefaults.buttonColors(containerColor = Color.White.copy(alpha = 0.13f))) {
                                    Text(if (senhaSala.isBlank()) "Remover senha" else "Definir senha", color = Color.White, fontSize = 11.sp)
                                }
                            }
                            OutlinedTextField(
                                value = senhaSala,
                                onValueChange = { senhaSala = it.take(24) },
                                modifier = Modifier.fillMaxWidth(),
                                label = { Text("Nova senha (vazio remove)") },
                                singleLine = true,
                            )
                            if (jogadoresDisponiveis.isNotEmpty()) {
                                Text("Convidar jogador", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                jogadoresDisponiveis.take(10).forEach { player ->
                                    val convidado = player.uid in room.convitesUids
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                        Text(player.apelido, color = Color.White.copy(alpha = 0.8f), fontSize = 11.sp)
                                        TextButton(onClick = {
                                            carregando = true
                                            onGerenciarSala(room.id, "addInvite", UUID.randomUUID().toString(), player.uid, 0, "") { next, error ->
                                                carregando = false
                                                if (error != null) erro = error.localizedMessage.orEmpty() else salaSelecionada = next
                                            }
                                        }, enabled = !carregando) { Text(if (convidado) "Reenviar · 30 s" else "Convidar") }
                                        if (convidado) {
                                            TextButton(onClick = {
                                                carregando = true
                                                onGerenciarSala(room.id, "removeInvite", UUID.randomUUID().toString(), player.uid, 0, "") { next, error ->
                                                    carregando = false
                                                    if (error != null) erro = error.localizedMessage.orEmpty() else salaSelecionada = next
                                                }
                                            }, enabled = !carregando) { Text("Remover", color = Color(0xFFFF8B91)) }
                                        }
                                    }
                                }
                            }
                            TextButton(onClick = { compartilharConvite(room.id) }, enabled = !carregando) {
                                Text("Compartilhar link de convite", color = Cores.Turquesa)
                            }
                            TextButton(
                                onClick = { confirmarAcaoSala = "dissolve" to "" },
                                enabled = !carregando,
                            ) { Text("Dissolver sala e devolver apostas", color = Color(0xFFFF8B91)) }
                        } else if (souParticipante) {
                            Text(
                                if (room.modo == "2v2") "Você entrou. A partida começa quando os 4 jogadores estiverem na sala."
                                else "Você entrou. Aguardando o criador iniciar a partida.",
                                color = Color.White.copy(alpha = 0.65f),
                                fontSize = 11.sp,
                            )
                        } else {
                            OutlinedTextField(value = senhaEntrada, onValueChange = { senhaEntrada = it.take(24) }, label = { Text("Senha da sala") }, singleLine = true)
                            Button(onClick = {
                                if (!apostarEmSala(room.apostaCentavos)) return@Button
                                carregando = true
                                onEntrarSala(room.id, senhaEntrada, UUID.randomUUID().toString()) { next, error ->
                                    carregando = false
                                    if (error != null) erro = error.localizedMessage.orEmpty() else {
                                        salaSelecionada = next
                                        aviso = "Você entrou na sala."
                                    }
                                }
                            }, enabled = !carregando, colors = ButtonDefaults.buttonColors(containerColor = Cores.Verde)) {
                                Text("Entrar · ${formatarSaldoTug(room.apostaCentavos)}", color = Color(0xFF101417), fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                    "ready" -> {
                        Text("${room.timeA.size + room.timeB.size} jogadores entraram · sala pronta", color = Cores.Verde, fontSize = 12.sp)
                        if (souCriador) {
                            Button(onClick = { confirmarAcaoSala = "start" to "" }, enabled = !carregando, colors = ButtonDefaults.buttonColors(containerColor = Cores.Verde)) {
                                Text("Iniciar partida", color = Color(0xFF101417), fontWeight = FontWeight.Bold)
                            }
                            (room.timeA + room.timeB).filter { it.uid != uidAtual }.forEach { player ->
                                TextButton(
                                    onClick = { confirmarAcaoSala = "kick" to player.uid },
                                    enabled = !carregando,
                                ) { Text("Remover ${player.nome} · reembolsar", color = Color(0xFFFF8B91)) }
                            }
                        } else Text("Aguardando o criador iniciar…", color = Color.White.copy(alpha = 0.62f), fontSize = 11.sp)
                    }
                    "active" -> {
                        val buttonScale by animateFloatAsState(
                            targetValue = if (puxoesPendentes > 0 && room.gameId != "teamBlitz") 0.96f else 1f,
                            animationSpec = tween(90),
                            label = "tug-tap-scale",
                        )
                        val pendingScore = if (room.gameId == "teamBlitz") 0 else puxoesPendentes
                        val puxoesTimeAVisual = room.puxoesTimeA + if (souTimeA) pendingScore else 0
                        val puxoesTimeBVisual = room.puxoesTimeB + if (souTimeB) pendingScore else 0
                        val lead = puxoesTimeAVisual - puxoesTimeBVisual
                        Text("Time A: $puxoesTimeAVisual  ·  $puxoesTimeBVisual :Time B", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                        if (room.gameId == "teamBlitz") {
                            val questionIndex = ((room.puxoesTimeA + room.puxoesTimeB) / 2) % teamQuizQuestions.size
                            val question = teamQuizQuestions[questionIndex]
                            Text("Quiz relâmpago · acerte para marcar 2 pontos", color = Cores.Turquesa, fontWeight = FontWeight.Bold)
                            Text(question.prompt, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                            question.answers.forEachIndexed { index, answer ->
                                Button(
                                    onClick = {
                                        puxoesPendentes = index + 1
                                        erro = ""
                                        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                    },
                                    enabled = !enviandoLotePuxoes && puxoesPendentes == 0,
                                    modifier = Modifier.fillMaxWidth(),
                                    colors = ButtonDefaults.buttonColors(containerColor = if (souTimeA) Cores.Verde else Color(0xFFFF8B91)),
                                ) {
                                    Text(answer, color = Color(0xFF101417), fontWeight = FontWeight.Bold)
                                }
                            }
                            if (enviandoLotePuxoes) Text("Verificando resposta…", color = Color.White.copy(alpha = 0.65f))
                        } else {
                            TugRopeVisual(lead)
                            Text("Toques registrados na hora${if (puxoesPendentes > 0) " · +$puxoesPendentes" else ""}", modifier = Modifier.fillMaxWidth(), color = Color.White.copy(alpha = 0.6f), fontSize = 11.sp, textAlign = TextAlign.Center)
                            val meuTime = if (souTimeA) "A" else "B"
                            val vezDoColega = room.gameId == "teamRelay"
                                && room.ultimoJogadorPorTime[meuTime] == uidAtual
                            Button(
                                onClick = {
                                    val nowMs = SystemClock.elapsedRealtime()
                                    if (ultimoToqueMs == 0L || nowMs - ultimoToqueMs >= 120L) {
                                        ultimoToqueMs = nowMs
                                        puxoesPendentes += 1
                                        erro = ""
                                        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                    }
                                },
                                enabled = !enviandoLotePuxoes && !vezDoColega,
                                modifier = Modifier.fillMaxWidth().height(72.dp).graphicsLayer {
                                    scaleX = buttonScale
                                    scaleY = buttonScale
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = if (souTimeA) Cores.Verde else Color(0xFFFF8B91)),
                            ) {
                                Text(
                                    when {
                                        vezDoColega -> "AGUARDE SEU COLEGA"
                                        room.gameId == "teamRace" -> "TOQUE PARA CORRER"
                                        room.gameId == "teamRelay" -> "TOQUE PARA REVEZAR"
                                        else -> "TOQUE PARA PUXAR"
                                    },
                                    color = Color(0xFF101417),
                                    fontWeight = FontWeight.Black,
                                )
                            }
                        }
                    }
                    "settled" -> {
                        val venceu = if (room.timeVencedor.isNotBlank()) {
                            if (room.timeVencedor == "A") souTimeA else souTimeB
                        } else room.vencedorUid == uidAtual
                        Text(if (venceu) "Seu time venceu · prêmio ${formatarSaldoTug(room.apostaCentavos * 2)}" else "Partida encerrada · seu time perdeu", color = if (venceu) Cores.Verde else Color(0xFFFF8B91), fontWeight = FontWeight.Bold)
                    }
                }
                TextButton(
                    onClick = {
                        if (room.status in listOf("waiting", "ready")) {
                            val action = if (souCriador) "dissolve" else "leave"
                            carregando = true
                            onGerenciarSala(room.id, action, UUID.randomUUID().toString(), "", 0, "") { _, error ->
                                carregando = false
                                if (error != null) {
                                    erro = error.localizedMessage.orEmpty()
                                } else {
                                    salaSelecionada = null
                                    aviso = if (souCriador) "Sala dissolvida · todas as apostas foram devolvidas." else "Você saiu · sua aposta foi devolvida."
                                    atualizarSalas()
                                }
                            }
                        } else if (room.status == "settled") {
                            carregando = true
                            onGerenciarSala(room.id, "leaveCompleted", UUID.randomUUID().toString(), "", 0, "") { _, error ->
                                carregando = false
                                if (error != null) {
                                    erro = error.localizedMessage.orEmpty()
                                } else {
                                    salaSelecionada = null
                                    aviso = "Você saiu da partida. Após todos saírem, a sala será removida em 2 minutos."
                                    atualizarSalas()
                                }
                            }
                        } else {
                            salaSelecionada = null
                            atualizarSalas()
                        }
                    },
                    enabled = !carregando,
                ) {
                    Text(
                        when {
                            room.status in listOf("waiting", "ready") && souCriador -> "Dissolver sala · reembolsar todos"
                            room.status in listOf("waiting", "ready") -> "Sair da sala · devolver aposta"
                            room.status == "active" -> "Minimizar partida"
                            room.status == "settled" -> "Sair da partida"
                            else -> "Voltar às salas"
                        },
                        color = if (room.status in listOf("waiting", "ready")) Color(0xFFFF8B91) else Color.White,
                    )
                }
            }
        }

        if (salaSelecionada == null) {
            Text("Formato da sala", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            if (gameIdInicial == "tug") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("1v1", "2v2").forEach { mode ->
                        Button(
                            onClick = { modoSala = mode },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (modoSala == mode) Cores.Turquesa else Color.White.copy(alpha = 0.12f),
                            ),
                        ) { Text(mode, color = if (modoSala == mode) Color(0xFF101417) else Color.White, fontWeight = FontWeight.Bold) }
                    }
                }
            } else {
                Text("Modo 2v2 · todos os quatro lugares são necessários", color = Cores.Turquesa, fontSize = 11.sp)
            }
            if (modoSala == "2v2") {
                Text("O servidor distribui novos jogadores para equilibrar o nível das equipes.", color = Color.White.copy(alpha = 0.62f), fontSize = 11.sp)
            }
            val presetsForGame = predefinicoes.filter { it.gameId == gameIdInicial }
            if (presetsForGame.isNotEmpty()) {
                Text("Predefinições salvas", color = Cores.Turquesa, fontWeight = FontWeight.Bold, fontSize = 11.sp)
                presetsForGame.forEach { preset ->
                    TextButton(
                        enabled = !carregando,
                        onClick = {
                            modoSala = preset.modo
                            stakeTexto = formatarSaldoTug(preset.apostaCentavos).removePrefix("R$ ").trim()
                                .replace(".", "").replace(",", ".")
                        },
                    ) { Text("${preset.nome} · ${preset.modo} · ${formatarSaldoTug(preset.apostaCentavos)}") }
                }
            }
            OutlinedTextField(
                value = stakeTexto,
                onValueChange = { stakeTexto = it.filter { char -> char.isDigit() || char == ',' || char == '.' }.take(12) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Aposta por jogador") },
                prefix = { Text("R$ ") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            )
            OutlinedTextField(
                value = nomePredefinicao,
                onValueChange = { nomePredefinicao = it.take(24) },
                label = { Text("Nome para salvar esta configuração") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            TextButton(
                enabled = nomePredefinicao.trim().length >= 2 && predefinicoes.size < 5 && !carregando,
                onClick = {
                    val stake = parseSaldoTug(stakeTexto)
                    if (stake == null || !apostarEmSala(stake)) return@TextButton
                    val preset = PredefinicaoSala(nomePredefinicao.trim(), modoSala, gameIdInicial, stake)
                    if (predefinicoes.any { it.nome.equals(preset.nome, ignoreCase = true) }) {
                        erro = "Já existe uma predefinição com esse nome."
                        return@TextButton
                    }
                    val updated = predefinicoes + preset
                    carregando = true
                    onSalvarPredefinicoes(updated) { error ->
                        carregando = false
                        if (error != null) erro = error.localizedMessage ?: "Não foi possível salvar."
                        else {
                            predefinicoes = updated
                            nomePredefinicao = ""
                            aviso = "Predefinição salva."
                        }
                    }
                },
            ) {
                Text(if (predefinicoes.size >= 5) "Limite de 5 predefinições" else "Salvar predefinição")
            }
            OutlinedTextField(value = senhaSala, onValueChange = { senhaSala = it.take(24) }, modifier = Modifier.fillMaxWidth(), label = { Text("Senha opcional da sala") }, singleLine = true)
            if (clanId.isNotBlank()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = salaDoCla, onCheckedChange = { salaDoCla = it })
                    Text("Sala exclusiva para membros do meu clã", color = Color.White, fontSize = 12.sp)
                }
            }
            if (jogadoresDisponiveis.isNotEmpty()) {
                Text("Convide alguém (opcional)", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Text("${convidados.size}/${if (modoSala == "2v2") 3 else 1} convites selecionados", color = Color.White.copy(alpha = 0.55f), fontSize = 10.sp)
                jogadoresDisponiveis.take(10).forEach { player ->
                    val conviteSelecionado = player.uid in convidados
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text(player.apelido, color = Color.White.copy(alpha = 0.8f), fontSize = 11.sp)
                        TextButton(onClick = {
                            if (conviteSelecionado) convidados.remove(player.uid)
                            else if (convidados.size < if (modoSala == "2v2") 3 else 1) convidados.add(player.uid)
                            else erro = "Este formato permite até ${if (modoSala == "2v2") 3 else 1} convite(s)."
                        }) { Text(if (conviteSelecionado) "Convidado" else "Convidar") }
                    }
                }
            }
            Button(
                onClick = {
                    val stake = parseSaldoTug(stakeTexto)
                    if (stake == null || !apostarEmSala(stake)) return@Button
                    carregando = true
                    onCriarSala(
                        stake,
                        convidados.toList(),
                        senhaSala,
                        modoSala,
                        gameIdInicial,
                        if (salaDoCla) clanId else "",
                        UUID.randomUUID().toString(),
                    ) { room, error ->
                        carregando = false
                        if (error != null) erro = error.localizedMessage.orEmpty() else {
                            salaSelecionada = room
                            erro = ""
                            aviso = "Sala criada. A aposta foi reservada."
                        }
                    }
                },
                enabled = !carregando,
                colors = ButtonDefaults.buttonColors(containerColor = Cores.Turquesa),
            ) { Text("Criar sala", color = Color(0xFF101417), fontWeight = FontWeight.Bold) }

            Text("Salas disponíveis e partidas finalizadas", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("Todas", "Aguardando", "Com vaga", "1v1", "2v2").forEach { filter ->
                    TextButton(onClick = { filtroSalas = filter }) {
                        Text(filter, color = if (filter == filtroSalas) Cores.Turquesa else Color.White.copy(alpha = 0.7f), fontSize = 11.sp)
                    }
                }
            }
            val salasDoJogo = salas.filter { room ->
                val maxPlayers = if (room.modo == "2v2") 4 else 2
                room.gameId == gameIdInicial && when (filtroSalas) {
                    "Aguardando" -> room.status in listOf("waiting", "ready")
                    "Com vaga" -> room.status == "waiting" && room.timeA.size + room.timeB.size < maxPlayers
                    "1v1" -> room.modo == "1v1"
                    "2v2" -> room.modo == "2v2"
                    else -> true
                }
            }
            if (salasDoJogo.isEmpty()) Text("Nenhuma sala disponível agora.", color = Color.White.copy(alpha = 0.6f), fontSize = 11.sp)
            salasDoJogo.forEach { room ->
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp)).background(Color.White.copy(alpha = 0.06f)).clickable { salaSelecionada = room }.padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    if (room.clanId.isNotBlank()) {
                        Text("Sala exclusiva do clã", color = Cores.Turquesa, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    }
                    Text(
                        when {
                            room.conviteParaMim -> "Convite · ${room.criadorNome}"
                            room.status == "settled" -> "Partida finalizada · toque para sair"
                            room.criadorUid == uidAtual -> "Sua sala · ${room.status}"
                            else -> "Sala pública · ${room.criadorNome}"
                        },
                        color = if (room.conviteParaMim) Cores.Turquesa else Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 11.sp,
                    )
                    val maxPlayers = if (room.modo == "2v2") 4 else 2
                    Text(
                        "${room.modo} · ${room.timeA.size + room.timeB.size}/$maxPlayers jogadores · ${formatarSaldoTug(room.apostaCentavos)} cada${if (room.protegidaPorSenha) " · senha" else ""}",
                        color = Color.White.copy(alpha = 0.64f),
                        fontSize = 10.sp,
                    )
                }
            }
        }
        if (aviso.isNotBlank()) Text(aviso, color = Cores.Verde, fontSize = 11.sp)
        if (erro.isNotBlank()) Text(erro, modifier = Modifier.fillMaxWidth().background(Color(0xFF34272A), RoundedCornerShape(8.dp)).padding(10.dp), color = Color(0xFFFFB7A7), fontSize = 11.sp)
    }

    confirmarAcaoSala?.let { (action, targetUid) ->
        val room = salaSelecionada
        AlertDialog(
            onDismissRequest = { confirmarAcaoSala = null },
            title = {
                Text(
                    when (action) {
                        "dissolve" -> "Dissolver sala?"
                        "kick" -> "Remover participante?"
                        else -> "Iniciar partida?"
                    },
                )
            },
            text = {
                Text(
                    when (action) {
                        "dissolve" -> "A sala será encerrada e as apostas devolvidas a todos os participantes."
                        "kick" -> "O participante será removido e terá a aposta devolvida."
                        else -> "Confirma que todos estão prontos para começar?"
                    },
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmarAcaoSala = null
                        if (room == null) return@TextButton
                        carregando = true
                        if (action == "start") {
                            onIniciarSala(room.id) { next, error ->
                                carregando = false
                                if (error != null) erro = error.localizedMessage.orEmpty() else salaSelecionada = next
                            }
                        } else {
                            onGerenciarSala(room.id, action, UUID.randomUUID().toString(), targetUid, 0, "") { _, error ->
                                carregando = false
                                if (error != null) {
                                    erro = error.localizedMessage.orEmpty()
                                } else if (action == "dissolve") {
                                    salaSelecionada = null
                                    aviso = "Sala dissolvida. As apostas foram devolvidas."
                                    atualizarSalas()
                                } else {
                                    atualizarSalas()
                                }
                            }
                        }
                    },
                ) { Text("Confirmar") }
            },
            dismissButton = {
                TextButton(onClick = { confirmarAcaoSala = null }) { Text("Cancelar") }
            },
        )
    }

    if (chatAberto) {
        val roomId = salaSelecionada?.id
        Dialog(onDismissRequest = { chatAberto = false }) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 600.dp)
                    .verticalScroll(rememberScrollState())
                    .background(Color(0xFF17212B), RoundedCornerShape(18.dp))
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("Chat da partida", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 280.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    if (mensagensSala.isEmpty()) {
                        Text("Ainda não há mensagens.", color = Color.White.copy(alpha = 0.62f))
                    }
                    mensagensSala.forEach { message ->
                        Text("${message.nome}: ${message.texto}", color = Color.White, fontSize = 13.sp)
                    }
                }
                if (erroChatSala.isNotBlank()) Text(erroChatSala, color = Color(0xFFFF8B91), fontSize = 11.sp)
                Text("Mensagens rápidas", color = Cores.Turquesa, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                listOf(
                    "good_luck" to "Boa sorte!",
                    "well_played" to "Boa partida!",
                    "nice_move" to "Boa jogada!",
                    "ready" to "Estou pronto.",
                    "thanks" to "Obrigado!",
                    "reaction_laugh" to "😂",
                    "reaction_fire" to "🔥",
                    "reaction_heart" to "❤️",
                    "reaction_clap" to "👏",
                ).forEach { (code, label) ->
                    TextButton(
                        enabled = roomId != null && !carregando,
                        onClick = {
                            onEnviarMensagem(roomId.orEmpty(), "", code, UUID.randomUUID().toString()) { error ->
                                if (error != null) erroChatSala = error.localizedMessage ?: "Não foi possível enviar a mensagem."
                            }
                        },
                    ) { Text(label) }
                }
                OutlinedTextField(
                    value = textoMensagemSala,
                    onValueChange = { textoMensagemSala = it.take(140) },
                    label = { Text("Mensagem para esta partida") },
                    enabled = roomId != null && !carregando,
                )
                Button(
                    enabled = roomId != null && textoMensagemSala.isNotBlank() && !carregando,
                    onClick = {
                        onEnviarMensagem(roomId.orEmpty(), textoMensagemSala.trim(), "", UUID.randomUUID().toString()) { error ->
                            if (error != null) erroChatSala = error.localizedMessage ?: "Não foi possível enviar a mensagem."
                            else textoMensagemSala = ""
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Enviar") }
                TextButton(onClick = { chatAberto = false }, modifier = Modifier.fillMaxWidth()) { Text("Fechar") }
            }
        }
    }
}

private fun nomeJogoEquipe(gameId: String): String = when (gameId) {
    "teamRace" -> "Corrida em equipe"
    "teamRelay" -> "Revezamento"
    "teamBlitz" -> "Quiz relâmpago"
    else -> "Cabo de guerra"
}

private fun regraJogoEquipe(gameId: String): String = when (gameId) {
    "teamRace" -> "Primeiro time a 24 pontos vence"
    "teamRelay" -> "Alterne os toques entre colegas · 12 pontos vencem"
    "teamBlitz" -> "Responda perguntas de múltipla escolha · cada acerto vale 2 pontos"
    else -> "Toque para puxar · vantagem de 8 vence"
}

@Composable
private fun TugRopeVisual(lead: Int) {
    val progress by animateFloatAsState(
        targetValue = (0.5f + lead / 16f).coerceIn(0.08f, 0.92f),
        animationSpec = tween(durationMillis = 180),
        label = "tug-rope-position",
    )
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text("◀", color = Cores.Verde, fontWeight = FontWeight.Black)
        BoxWithConstraints(Modifier.weight(1f).height(28.dp).padding(horizontal = 8.dp), contentAlignment = Alignment.CenterStart) {
            Box(Modifier.fillMaxWidth().height(8.dp).background(Color(0xFF806344), RoundedCornerShape(6.dp)))
            Box(Modifier.offset(x = maxWidth * progress - 10.dp).size(20.dp).background(Color(0xFFFFD166), RoundedCornerShape(50)))
        }
        Text("▶", color = Color(0xFFFF8B91), fontWeight = FontWeight.Black)
    }
}

private fun formatarSaldoTug(centavos: Long): String =
    NumberFormat.getCurrencyInstance(Locale.forLanguageTag("pt-BR"))
        .format(BigDecimal.valueOf(centavos, 2))

private fun parseSaldoTug(valor: String): Long? = runCatching {
    BigDecimal(valor.trim().replace(',', '.')).movePointRight(2).longValueExact()
}.getOrNull()?.takeIf { it > 0 }