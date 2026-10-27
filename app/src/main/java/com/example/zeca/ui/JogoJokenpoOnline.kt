package com.example.zeca.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.zeca.PartidaJokenpo
import com.example.zeca.ResultadoJokenpo
import com.example.zeca.ui.theme.Cores
import com.google.firebase.firestore.ListenerRegistration
import kotlinx.coroutines.delay
import java.util.UUID

@Composable
internal fun JogoJokenpoOnline(
    uidAtual: String,
    gameId: String,
    gameName: String,
    onObservarFila: ((String, String, Boolean) -> Unit) -> ListenerRegistration,
    onObservarPartida: (String, (PartidaJokenpo?, Exception?) -> Unit) -> ListenerRegistration,
    onBuscarAdversario: (String, String, (String, String, Exception?) -> Unit) -> Unit,
    onCancelarFila: ((Exception?) -> Unit) -> Unit,
    onJogar: (String, String, String, (ResultadoJokenpo?, Exception?) -> Unit) -> Unit,
    onPedirRevanche: (String, String, (String, String, Exception?) -> Unit) -> Unit,
) {
    var statusFila by rememberSaveable { mutableStateOf("") }
    var matchId by rememberSaveable { mutableStateOf("") }
    var jaEscolheu by rememberSaveable { mutableStateOf(false) }
    var partida by remember { mutableStateOf<PartidaJokenpo?>(null) }
    var ocupado by remember { mutableStateOf(false) }
    var erro by rememberSaveable { mutableStateOf("") }
    var informacao by rememberSaveable { mutableStateOf("") }
    val escolhasDuelo = remember(matchId) { mutableStateListOf<String>() }
    var sequenciaMemoriaVisivel by remember(matchId) { mutableStateOf(true) }
    val observarFilaAtual by rememberUpdatedState(onObservarFila)
    val observarPartidaAtual by rememberUpdatedState(onObservarPartida)

    DisposableEffect(uidAtual) {
        val registration = observarFilaAtual { status, newMatchId, hasPlayed ->
            statusFila = status
            jaEscolheu = hasPlayed
            if (matchId != newMatchId) {
                matchId = newMatchId
                partida = null
            }
            if (status.isBlank() && newMatchId.isBlank()) jaEscolheu = false
        }
        onDispose { registration.remove() }
    }

    DisposableEffect(matchId) {
        if (matchId.isBlank()) {
            partida = null
            onDispose { }
        } else {
            val registration = observarPartidaAtual(matchId) { state, error ->
                partida = state
                if (error != null) erro = error.localizedMessage ?: "Não foi possível atualizar a partida."
            }
            onDispose { registration.remove() }
        }
    }

    val adversarioUid = partida?.jogadorUids?.firstOrNull { it != uidAtual }.orEmpty()
    val statusPartida = partida?.status.orEmpty()
    val partidaConcluida = statusPartida == "completed"
    val sequenceMemory = remember(matchId) { memoryPattern(matchId) }
    val quizQuestionIndexes = remember(matchId) { shuffledQuestionIndexes(matchId) }
    val resultadoPessoal = when {
        !partidaConcluida -> ""
        partida?.vencedorUid.isNullOrBlank() -> "Empate"
        partida?.vencedorUid == uidAtual -> "Você venceu"
        else -> "Seu adversário venceu"
    }
    val gameIdPartida = partida?.gameId ?: gameId
    LaunchedEffect(matchId, gameIdPartida, sequenciaMemoriaVisivel) {
        if (matchId.isNotBlank() && gameIdPartida == "duelMemory" && sequenciaMemoriaVisivel) {
            delay(5_000)
            sequenciaMemoriaVisivel = false
        }
    }
    val opcoes = when (gameIdPartida) {
        "duelParity" -> listOf("even" to "Par", "odd" to "Ímpar")
        "duelCoin" -> listOf("heads" to "Cara", "tails" to "Coroa")
        "duelMemory" -> (0..3).map { it.toString() to "Sinal ${it + 1}" }
        "duelQuiz" -> {
            val questionIndex = quizQuestionIndexes.getOrNull(escolhasDuelo.size) ?: quizQuestionIndexes.last()
            soloQuestions[questionIndex].answers.mapIndexed { index, answer -> index.toString() to answer }
        }
        "duelTarget" -> (0..9).map { it.toString() to it.toString() }
        else -> listOf("rock" to "Pedra", "paper" to "Papel", "scissors" to "Tesoura")
    }
    val instrucoes = when (gameIdPartida) {
        "duelParity" -> "Melhor de cinco rodadas: adivinhe a paridade de cada dado. Só a previsão exclusiva marca ponto."
        "duelCoin" -> "Melhor de cinco rodadas: preveja cada lançamento. Só a previsão exclusiva marca ponto."
        "duelMemory" -> "Memorize a sequência exibida por cinco segundos e repita-a. O servidor compara os acertos."
        "duelQuiz" -> "Responda cinco perguntas; o servidor verifica as respostas e compara a pontuação."
        "duelTarget" -> "Em cinco rodadas, escolha o número mais próximo do alvo oculto."
        else -> "Partida amistosa · sem aposta"
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Color.White.copy(alpha = 0.055f))
            .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(16.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(Cores.Turquesa.copy(alpha = 0.18f)),
                contentAlignment = Alignment.Center,
            ) {
                Text("1v1", color = Cores.Turquesa, fontSize = 12.sp, fontWeight = FontWeight.Black)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(gameName, color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                Text(instrucoes, color = Color.White.copy(alpha = 0.58f), fontSize = 11.sp)
            }
        }

        when {
            partidaConcluida -> {
                Text(resultadoPessoal, color = if (resultadoPessoal == "Você venceu") Cores.Verde else Color.White, fontSize = 20.sp, fontWeight = FontWeight.Black)
                Text(partida?.resultado.orEmpty(), color = Color.White.copy(alpha = 0.72f), fontSize = 13.sp)
                val opponentRequested = partida?.revengeRequestedBy?.any { it != uidAtual } == true
                val selfRequested = uidAtual in partida?.revengeRequestedBy.orEmpty()
                Button(
                    onClick = {
                        ocupado = true
                        erro = ""
                        informacao = ""
                        onPedirRevanche(matchId, UUID.randomUUID().toString()) { status, newMatchId, error ->
                            ocupado = false
                            if (error != null) erro = error.localizedMessage ?: "Não foi possível pedir revanche."
                            else {
                                if (status == "matched" && newMatchId.isNotBlank()) {
                                    statusFila = "matched"
                                    matchId = newMatchId
                                    jaEscolheu = false
                                    partida = null
                                } else {
                                    informacao = "Pedido enviado. A revanche começa quando seu adversário aceitar."
                                    partida = partida?.copy(revengeRequestedBy = partida?.revengeRequestedBy.orEmpty() + uidAtual)
                                }
                            }
                        }
                    },
                    enabled = !ocupado,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        when {
                            ocupado -> "Enviando pedido..."
                            opponentRequested -> "Aceitar revanche"
                            selfRequested -> "Aguardando adversário..."
                            else -> "Pedir revanche"
                        },
                    )
                }
                if (selfRequested && !opponentRequested) {
                    Text("Aguarde o adversário aceitar para jogar novamente.", color = Color.White.copy(alpha = 0.6f), fontSize = 11.sp)
                }
                if (informacao.isNotBlank()) {
                    Text(informacao, color = Cores.Turquesa, fontSize = 12.sp)
                }
            }
            statusPartida == "playing" -> {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PlayerChip("Você", partida?.nomesJogadores?.get(uidAtual).orEmpty(), Modifier.weight(1f))
                    Text("VS", color = Cores.Turquesa, fontSize = 11.sp, fontWeight = FontWeight.Black)
                    PlayerChip("Adversário", partida?.nomesJogadores?.get(adversarioUid).orEmpty(), Modifier.weight(1f))
                }
                if (jaEscolheu) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        CircularProgressIndicator(Modifier.size(18.dp), color = Cores.Turquesa, strokeWidth = 2.dp)
                        Text("Jogada enviada · aguardando o adversário", color = Color.White.copy(alpha = 0.75f), fontSize = 12.sp)
                    }
                } else {
                    val multiRound = gameIdPartida in setOf("duelParity", "duelCoin", "duelQuiz", "duelTarget")
                    val memoryGame = gameIdPartida == "duelMemory"
                    Text(
                        when {
                            memoryGame -> "Memorize a sequência de sete sinais"
                            multiRound -> "Rodada ${escolhasDuelo.size + 1}/5"
                            else -> "Escolha sua jogada"
                        },
                        color = Color.White.copy(alpha = 0.75f), fontSize = 12.sp,
                    )
                    if (memoryGame) {
                        Text(
                            if (sequenciaMemoriaVisivel) sequenceMemory.joinToString("  ") { "●${it + 1}" }
                            else "A sequência sumiu · ${escolhasDuelo.size}/7",
                            modifier = Modifier.fillMaxWidth(),
                            color = Cores.Turquesa, fontSize = 22.sp, fontWeight = FontWeight.Black,
                        )
                    }
                    if (gameIdPartida == "duelQuiz") {
                        val questionIndex = quizQuestionIndexes.getOrNull(escolhasDuelo.size) ?: quizQuestionIndexes.last()
                        Text(soloQuestions[questionIndex].text, color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    }
                    if (gameIdPartida == "duelTarget") {
                        Text("Escolha o valor mais próximo do alvo desta rodada.", color = Color.White.copy(alpha = 0.72f), fontSize = 12.sp)
                    }
                    if (multiRound && escolhasDuelo.isNotEmpty()) {
                        Text("Suas previsões: ${escolhasDuelo.size}", color = Color.White.copy(alpha = 0.58f), fontSize = 11.sp)
                    }
                    opcoes.chunked(3).forEach { linha ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            linha.forEach { (value, label) ->
                                Button(
                                    onClick = {
                                        if (multiRound || memoryGame) escolhasDuelo.add(value)
                                        val submittedChoice = when {
                                            memoryGame -> escolhasDuelo.joinToString("")
                                            multiRound -> escolhasDuelo.joinToString(",")
                                            else -> value
                                        }
                                        if ((multiRound && escolhasDuelo.size < 5)
                                            || (memoryGame && escolhasDuelo.size < 7)) return@Button
                                        ocupado = true
                                        erro = ""
                                        onJogar(matchId, submittedChoice, UUID.randomUUID().toString()) { result, error ->
                                            ocupado = false
                                            if (error != null || result == null) {
                                                erro = error?.localizedMessage ?: "Não foi possível enviar sua jogada."
                                                if (multiRound || memoryGame) {
                                                    escolhasDuelo.clear()
                                                    sequenciaMemoriaVisivel = true
                                                }
                                            } else {
                                                jaEscolheu = true
                                                if (result.status == "completed") {
                                                    partida = partida?.copy(
                                                        status = result.status,
                                                        vencedorUid = result.vencedorUid,
                                                        resultado = result.resultado,
                                                    )
                                                }
                                            }
                                        }
                                    },
                                    enabled = !ocupado && (!memoryGame || !sequenciaMemoriaVisivel),
                                    modifier = Modifier.weight(1f),
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = if (ocupado) Color.White.copy(alpha = 0.1f) else Cores.Turquesa.copy(alpha = 0.9f),
                                    ),
                                ) {
                                    Text(
                                        if (multiRound && ocupado) "Enviando…" else label,
                                        color = Color(0xFF10201D), fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold, maxLines = 1,
                                    )
                                }
                            }
                            repeat(3 - linha.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }
            statusFila == "waiting" -> {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    CircularProgressIndicator(Modifier.size(18.dp), color = Cores.Turquesa, strokeWidth = 2.dp)
                    Text("Procurando adversário...", color = Color.White.copy(alpha = 0.8f), fontSize = 13.sp)
                }
                Button(
                    onClick = {
                        ocupado = true
                        onCancelarFila { error ->
                            ocupado = false
                            if (error != null) erro = error.localizedMessage ?: "Não foi possível cancelar a busca."
                            else {
                                statusFila = ""
                                matchId = ""
                                jaEscolheu = false
                                partida = null
                            }
                        }
                    },
                    enabled = !ocupado,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Color.White.copy(alpha = 0.12f)),
                ) { Text("Cancelar busca", color = Color.White) }
            }
            matchId.isNotBlank() -> {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    CircularProgressIndicator(Modifier.size(18.dp), color = Cores.Turquesa, strokeWidth = 2.dp)
                    Text("Abrindo a partida...", color = Color.White.copy(alpha = 0.8f), fontSize = 13.sp)
                }
            }
            else -> {
                Text("Encontre alguém online para jogar $gameName.", color = Color.White.copy(alpha = 0.65f), fontSize = 12.sp)
                Button(
                    onClick = {
                        ocupado = true
                        erro = ""
                        onBuscarAdversario(gameId, UUID.randomUUID().toString()) { status, newMatchId, error ->
                            ocupado = false
                            if (error != null) erro = error.localizedMessage ?: "Não foi possível buscar uma partida."
                            else {
                                statusFila = status
                                matchId = newMatchId
                                jaEscolheu = false
                                partida = null
                            }
                        }
                    },
                    enabled = !ocupado,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (ocupado) "Buscando..." else "Buscar adversário") }
            }
        }

        if (erro.isNotBlank()) Text(erro, color = Cores.Laranja, fontSize = 12.sp)
    }
}

@Composable
private fun PlayerChip(rotulo: String, nome: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(11.dp))
            .background(Color.Black.copy(alpha = 0.18f))
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(rotulo, color = Cores.Turquesa, fontSize = 9.sp, fontWeight = FontWeight.Bold)
        Text(nome.ifBlank { "Jogador" }, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}