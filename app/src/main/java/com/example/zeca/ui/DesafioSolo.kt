package com.example.zeca.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.zeca.ui.theme.Cores
import kotlinx.coroutines.delay

internal data class QuizQuestion(val text: String, val answers: List<String>, val correct: Int)

internal val soloQuestions = listOf(
    QuizQuestion("Quantos lados tem um hexágono?", listOf("5", "6", "7", "8"), 1),
    QuizQuestion("Qual planeta é conhecido como planeta vermelho?", listOf("Vênus", "Marte", "Júpiter", "Mercúrio"), 1),
    QuizQuestion("Quanto é 9 × 7?", listOf("56", "63", "72", "81"), 1),
    QuizQuestion("Qual é o maior oceano da Terra?", listOf("Atlântico", "Índico", "Pacífico", "Ártico"), 2),
    QuizQuestion("Quantos minutos há em duas horas?", listOf("100", "110", "120", "140"), 2),
    QuizQuestion("Qual destes animais é um mamífero?", listOf("Tubarão", "Golfinho", "Polvo", "Truta"), 1),
    QuizQuestion("Qual é a raiz quadrada de 144?", listOf("10", "11", "12", "14"), 2),
    QuizQuestion("Em que direção o Sol nasce?", listOf("Norte", "Sul", "Leste", "Oeste"), 2),
)

internal fun seededRandom(seed: String): (Int) -> Int {
    val normalized = seed.filter { it.isDigit() || it.lowercaseChar() in 'a'..'f' }.take(8)
    var state = ((normalized.ifEmpty { "1" }.toLong(16) % 2_147_483_646L) + 1L)
    return { max ->
        state = state * 16_807L % 2_147_483_647L
        (state % max).toInt()
    }
}

internal fun memoryPattern(seed: String): List<Int> {
    val next = seededRandom(seed)
    return List(7) { next(4) }
}

internal fun shuffledQuestionIndexes(seed: String): List<Int> {
    val next = seededRandom(seed)
    val indexes = (0 until soloQuestions.size).toMutableList()
    for (index in indexes.lastIndex downTo 1) {
        val swap = next(index + 1)
        val value = indexes[index]
        indexes[index] = indexes[swap]
        indexes[swap] = value
    }
    return indexes.take(5)
}

private fun codeFor(seed: String): List<Int> {
    val next = seededRandom(seed)
    val code = mutableListOf<Int>()
    while (code.size < 4) {
        val digit = next(10)
        if (digit !in code) code.add(digit)
    }
    return code
}

private val mazeLayouts = listOf(
    setOf(1, 3, 6, 8, 11, 13, 16, 18, 21, 23),
    setOf(1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19),
    setOf(5, 6, 7, 8, 10, 11, 12, 13, 15, 16, 17, 18, 20, 21, 22),
)

private fun mazeWalls(seed: String): Set<Int> = mazeLayouts[seededRandom(seed)(mazeLayouts.size)]

@Composable
internal fun DesafioSolo(
    gameId: String,
    gameName: String,
    rules: String,
    round: Int,
    enabled: Boolean,
    busy: Boolean,
    result: String,
    message: String,
    profitCents: Long,
    onPrepare: ((String?, Exception?) -> Unit) -> Unit,
    onSubmit: (String) -> Unit,
) {
    var seed by rememberSaveable(gameId, round) { mutableStateOf("") }
    var preparing by remember { mutableStateOf(false) }
    var challengeError by rememberSaveable(gameId, round) { mutableStateOf("") }
    val pattern = remember(seed) { memoryPattern(seed) }
    val code = remember(seed) { codeFor(seed) }
    val walls = remember(seed) { mazeWalls(seed) }
    var revealing by remember(seed) { mutableStateOf(false) }
    var started by remember(seed) { mutableStateOf(false) }
    var litCell by remember(seed) { mutableStateOf<Int?>(null) }
    val entered = remember(seed) { mutableStateListOf<Int>() }
    val guesses = remember(seed) { mutableStateListOf<String>() }
    val path = remember(seed) { mutableStateListOf(0) }
    var currentGuess by remember(seed) { mutableStateOf("") }
    var questionPosition by remember(seed) { mutableStateOf(0) }
    val quizAnswers = remember(seed) { mutableStateListOf<Int>() }
    val questionIndexes = remember(seed) { shuffledQuestionIndexes(seed) }

    LaunchedEffect(revealing) {
        if (revealing) {
            pattern.forEach { cell ->
                litCell = cell
                delay(500)
                litCell = null
                delay(180)
            }
            revealing = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(Color(0xFF171D22))
            .border(1.dp, Cores.Turquesa.copy(alpha = 0.4f), RoundedCornerShape(18.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(gameName.uppercase(), color = Cores.Turquesa, fontSize = 12.sp, fontWeight = FontWeight.Black)
        Text(rules, color = Color.White.copy(alpha = 0.72f), fontSize = 12.sp)
        if (seed.isBlank()) {
            Button(
                onClick = {
                    preparing = true
                    challengeError = ""
                    onPrepare { challengeSeed, error ->
                        preparing = false
                        if (error == null && !challengeSeed.isNullOrBlank()) {
                            seed = challengeSeed
                        } else {
                            challengeError = error?.localizedMessage ?: "Não foi possível iniciar o desafio."
                        }
                    }
                },
                enabled = enabled && !busy && !preparing,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (preparing || busy) "Preparando desafio…" else "Iniciar desafio") }
        } else when (gameId) {
            "memorySequence" -> {
                Text(
                    if (revealing) "Memorize a sequência" else "Repita: ${entered.size}/${pattern.size}",
                    color = Color.White, fontWeight = FontWeight.Bold,
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    repeat(4) { cell ->
                        Box(
                            Modifier.weight(1f).aspectRatio(1f).clip(RoundedCornerShape(12.dp))
                                .background(if (litCell == cell) Cores.Turquesa else Color(0xFF29343B))
                                .clickable(enabled = enabled && !busy && started && !revealing && entered.size < pattern.size) {
                                    entered.add(cell)
                                },
                            contentAlignment = Alignment.Center,
                        ) { Text("${cell + 1}", color = Color.White, fontWeight = FontWeight.Black, fontSize = 20.sp) }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { started = true; revealing = true },
                        enabled = enabled && !busy && !started,
                    ) { Text("Mostrar sequência") }
                    Button(onClick = { onSubmit("$seed:${entered.joinToString("")}") }, enabled = enabled && !busy && started && !revealing && entered.isNotEmpty()) { Text("Conferir") }
                }
            }
            "quizSprint" -> {
                if (questionPosition < questionIndexes.size) {
                    val question = soloQuestions[questionIndexes[questionPosition]]
                    Text("PERGUNTA ${questionPosition + 1}/5", color = Cores.Turquesa, fontWeight = FontWeight.Bold)
                    Text(question.text, color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    question.answers.forEachIndexed { index, answer ->
                        ChallengeOption(answer, enabled && !busy) {
                            quizAnswers.add(index)
                            questionPosition += 1
                            if (quizAnswers.size == 5) onSubmit("$seed:${quizAnswers.joinToString("")}")
                        }
                    }
                }
            }
            "codebreaker" -> {
                Text("Tentativas: ${guesses.size}/8", color = Cores.Turquesa, fontWeight = FontWeight.Bold)
                Text(currentGuess.padEnd(4, '·'), color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Black, letterSpacing = 8.sp)
                if (guesses.isNotEmpty()) {
                    val last = guesses.last()
                    val exact = last.indices.count { last[it].digitToInt() == code[it] }
                    val near = last.map { it.digitToInt() }.distinct().count { it in code } - exact
                    Text("Último palpite: $exact no lugar certo · $near em outra posição", color = Color.White.copy(alpha = 0.72f), fontSize = 12.sp)
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    (0..9).forEach { digit ->
                        Text(
                            digit.toString(),
                            Modifier.weight(1f).clip(RoundedCornerShape(8.dp))
                                .background(Color(0xFF29343B)).clickable(enabled = enabled && !busy && currentGuess.length < 4) {
                                    currentGuess += digit
                                }.padding(vertical = 10.dp),
                            color = Color.White, textAlign = TextAlign.Center, fontWeight = FontWeight.Bold,
                        )
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { currentGuess = currentGuess.dropLast(1) }, enabled = currentGuess.isNotEmpty() && !busy) { Text("Apagar") }
                    Button(
                        onClick = {
                            guesses.add(currentGuess)
                            val done = guesses.size >= 8 || code.joinToString("") == currentGuess
                            currentGuess = ""
                            if (done) onSubmit("$seed:${guesses.joinToString(",")}")
                        },
                        enabled = enabled && !busy && currentGuess.length == 4,
                    ) { Text("Tentar") }
                }
            }
            "mazeRunner" -> {
                Text("Toque numa casa vizinha para avançar. Chegue à saída ✨", color = Color.White, fontSize = 12.sp)
                repeat(5) { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        repeat(5) { col ->
                            val cell = row * 5 + col
                            val isCurrentPath = cell in path
                            val isWall = cell in walls
                            Box(
                                Modifier.weight(1f).aspectRatio(1f).clip(RoundedCornerShape(7.dp))
                                    .background(
                                        when {
                                            isCurrentPath -> Cores.Turquesa
                                            isWall -> Color(0xFF5A3438)
                                            else -> Color(0xFF29343B)
                                        },
                                    )
                                    .clickable(enabled = enabled && !busy && !isWall && !isCurrentPath && path.size < 25) {
                                        val current = path.last()
                                        val adjacent = kotlin.math.abs(cell % 5 - current % 5) +
                                            kotlin.math.abs(cell / 5 - current / 5) == 1
                                        if (adjacent) {
                                            path.add(cell)
                                            if (cell == 24) onSubmit("$seed:${path.joinToString(",")}")
                                        }
                                    },
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    when {
                                        cell == 0 -> "▶"
                                        cell == 24 -> "★"
                                        isWall -> "■"
                                        isCurrentPath -> "•"
                                        else -> ""
                                    },
                                    color = Color.White, fontWeight = FontWeight.Black,
                                )
                            }
                        }
                    }
                }
                Button(
                    onClick = { if (path.size > 1) path.removeAt(path.lastIndex) },
                    enabled = enabled && !busy && path.size > 1,
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF29343B)),
                ) { Text("Voltar uma casa") }
            }
        }
        if (challengeError.isNotBlank()) {
            Text(challengeError, color = Color(0xFFFFB1B1), fontSize = 11.sp)
        }
        if (message.isNotBlank()) {
            Text(message, color = Color.White.copy(alpha = 0.72f), fontSize = 11.sp)
        }
        if (result != "Escolha um jogo para começar") {
            Text(result, color = Color.White, fontWeight = FontWeight.Bold)
            if (profitCents != 0L) Text(if (profitCents > 0) "Prêmio +${profitCents / 100.0}" else "Resultado ${profitCents / 100.0}", color = Cores.Verde)
        }
        if (busy || preparing) Text("Validando no servidor…", color = Color.White.copy(alpha = 0.65f), fontSize = 11.sp)
    }
}

@Composable
private fun ChallengeOption(label: String, enabled: Boolean, onClick: () -> Unit) {
    Text(
        label,
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Color(0xFF29343B))
            .clickable(enabled = enabled, onClick = onClick).padding(12.dp),
        color = Color.White, fontWeight = FontWeight.SemiBold,
    )
}
